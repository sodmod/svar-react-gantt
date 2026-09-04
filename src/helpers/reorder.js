import { locate, getID } from '@svar-ui/lib-dom';

function getOffset(node, relative, ev) {
  const box = node.getBoundingClientRect();
  const base = relative.querySelector('.wx-body').getBoundingClientRect();

  return {
    top: box.top - base.top,
    left: box.left - base.left,
    dt: box.bottom - ev.clientY,
    db: ev.clientY - box.top,
  };
}

function checkSource(node) {
  return node && getID(node, 'data-context-id');
}

const SHIFT = 5;

/*
 * SVAR-M13 (SVAR Production Planner): how much of a row, at each end, still
 * means "beside this row" rather than "into it".
 *
 * 0.3 leaves the middle 40% as the child band. Small enough that dropping
 * between two rows stays easy, large enough that hitting it is not a matter of
 * luck at the 48px row heights this renderer is used at.
 */
const CHILD_BAND_EDGE = 0.3;

export function reorder(node, config) {
  let source, clone, sid;
  let x, y, base, detail;
  let touched, touchTimer;

  function down(event) {
    x = event.clientX;
    y = event.clientY;
    base = {
      ...getOffset(source, node, event),
      y: config.getTask(sid).$y,
    };

    document.body.style.userSelect = 'none';
  }

  function handleTouchstart(event) {
    if (config.isDisabled?.()) return;
    source = locate(event);
    if (!checkSource(source)) return;

    sid = getID(source);

    touchTimer = setTimeout(() => {
      touched = true;
      if (config && config.touchStart) config.touchStart();
      down(event.touches[0]);
    }, 500);

    node.addEventListener('touchmove', handleTouchmove);
    node.addEventListener('contextmenu', handleContext);
    window.addEventListener('touchend', handleTouchend);
  }

  function handleContext(event) {
    if (touched || touchTimer) {
      event.preventDefault();
      return false;
    }
  }

  function handleMousedown(event) {
    if (config.isDisabled?.() || event.which !== 1) return;

    source = locate(event);
    if (!checkSource(source)) return;

    sid = getID(source);

    node.addEventListener('mousemove', handleMousemove);
    window.addEventListener('mouseup', handleMouseup);

    down(event);
  }

  function end(full) {
    node.removeEventListener('mousemove', handleMousemove);
    node.removeEventListener('touchmove', handleTouchmove);
    document.body.removeEventListener('mouseup', handleMouseup);
    document.body.removeEventListener('touchend', handleTouchend);
    document.body.style.userSelect = '';

    if (full) {
      node.removeEventListener('mousedown', handleMousedown);
      node.removeEventListener('touchstart', handleTouchstart);
    }
  }

  function move(event) {
    const dx = event.clientX - x;
    const dy = event.clientY - y;
    if (!clone) {
      if (Math.abs(dx) < SHIFT && Math.abs(dy) < SHIFT) return;
      if (config && config.start) {
        if (config.start({ id: sid, e: event }) === false) return;
      }

      clone = source.cloneNode(true);
      clone.style.pointerEvents = 'none';
      clone.classList.add('wx-reorder-task');
      clone.style.position = 'absolute';
      clone.style.left = base.left + 'px';
      clone.style.top = base.top + 'px';

      source.style.visibility = 'hidden';
      source.parentNode.insertBefore(clone, source);
    }

    if (clone) {
      const top = Math.round(Math.max(0, base.top + dy));

      if (config && config.move) {
        if (config.move({ id: sid, top, detail }) === false) return;
      }

      const task = config.getTask(sid);
      const y = task.$y;
      //dnd may be blocked
      if (!base.start && base.y === y) return up();

      base.start = true;
      base.y = task.$y - 4;
      clone.style.top = top + 'px'; //task.$y - scroll

      const targetNode = document.elementFromPoint(
        event.clientX,
        event.clientY,
      );
      const target = locate(targetNode);

      if (target && target !== source) {
        const tid = getID(target);
        const box = target.getBoundingClientRect();
        const line = box.top + box.height / 2;

        const after =
          event.clientY + base.db > line &&
          target.nextElementSibling !== source;
        const before =
          event.clientY - base.dt < line &&
          target.previousElementSibling !== source;

        /*
         * SVAR-M13 (SVAR Production Planner): the row's middle band means
         * "into this row", not "next to it".
         *
         * Before this, a row was split in two and a drag could only ever
         * express a position in an existing sibling list. Making one task the
         * parent of another was therefore impossible by direct manipulation,
         * even though `move-task` has always accepted `mode: 'child'` and the
         * store has always implemented it — `indent-task` is written in terms
         * of exactly that call.
         *
         * The band is measured from the POINTER against the target's own box,
         * unlike the two edge tests above, which compare the dragged row's
         * edges to the target's midline. That difference is deliberate: an
         * edge test asks "which side is the row falling on", and there is no
         * third side; "am I over the middle of that row" is a question about
         * where the user is pointing.
         */
        const middleTop = box.top + box.height * CHILD_BAND_EDGE;
        const middleBottom = box.bottom - box.height * CHILD_BAND_EDGE;
        const onto = event.clientY > middleTop && event.clientY < middleBottom;

        const zone = onto
          ? 'child'
          : after
            ? 'after'
            : before
              ? 'before'
              : null;
        if (zone) {
          if (detail && detail[zone] === tid) {
            // avoid duplicate calls — keyed on the ZONE as well as the target,
            // so moving from a row's edge to its middle is a real change.
            detail = null;
          } else {
            detail = { id: sid, [zone]: tid };
          }
        }
      }
    }
  }

  function handleMousemove(event) {
    move(event);
  }

  function handleTouchmove(event) {
    if (touched) {
      event.preventDefault();
      move(event.touches[0]);
    } else if (touchTimer) {
      clearTimeout(touchTimer);
      touchTimer = null;
    }
  }

  function handleTouchend() {
    touched = null;
    if (touchTimer) {
      clearTimeout(touchTimer);
      touchTimer = null;
    }
    up();
  }

  function handleMouseup() {
    up();
  }

  function up() {
    if (source) {
      source.style.visibility = '';
    }
    if (clone) {
      clone.parentNode.removeChild(clone);
      if (config && config.end) config.end({ id: sid, top: base.top });
    }

    sid = source = clone = base = detail = null;
    end();
  }

  if (node.style.position !== 'absolute') node.style.position = 'relative';

  node.addEventListener('mousedown', handleMousedown);
  node.addEventListener('touchstart', handleTouchstart);

  return {
    destroy() {
      end(true);
    },
  };
}

#!/usr/bin/env node
/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT.
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * WHY THIS FILE EXISTS
 *
 * Upstream draws this renderer's icons with an icon FONT. `@svar-ui/react-core`'s
 * theme components inject, at run time,
 *
 *   <link rel="preconnect" href="https://cdn.svar.dev" crossorigin>
 *   <link rel="stylesheet" href="https://cdn.svar.dev/fonts/wxi/wx-icons.css">
 *
 * and that stylesheet is what gives `.wxi-plus`, `.wxi-close` and the rest a
 * `content:"\eNNN"` glyph. The font is published on that CDN only — it is in no
 * npm package and in no public SVAR repository — so a deployment that cannot
 * reach the CDN gets zero-sized, invisible controls: measured, the add-task
 * icon is 0px wide and the link-delete icon 0px tall.
 *
 * The Planner therefore stops asking for that font at all (the theme wrappers
 * pass `fonts={false}` to core, which removes both links) and draws the icons
 * itself. This step turns the project's own SVG files under
 * `planner-assets/icons/` into one CSS block appended to `dist-full/index.css`,
 * with each icon inlined as a `data:` URI.
 *
 * WHY MASK-IMAGE AND NOT BACKGROUND-IMAGE OR <svg> ELEMENTS
 *
 * A mask painted with `background-color: currentColor` inherits `color` exactly
 * as a font glyph did, so every existing rule that themes these icons —
 * `--wx-gantt-icon-color`, `--wx-color-font-disabled`, the white on the danger
 * button, `:hover{color:var(--wx-color-primary)}` — keeps working untouched. A
 * `background-image` would need a separate file per colour AND would collide
 * with `.wx-button-expand-content i`, which already paints its own
 * `background-color`. Replacing the `<i>` elements with `<svg>` children would
 * mean editing several upstream components instead of adding one stylesheet.
 *
 * The icons are drawn on the `::before` pseudo-element for the same reason the
 * font was: that is where the glyph lived, and several upstream rules already
 * say `.wx-icon:before{display:block}`.
 *
 * WHY data: URIs AND NOT FILES
 *
 * An icon that fails to load is the defect this checkpoint exists to remove.
 * Inlined bytes cannot 404, cannot be blocked, and need no consumer-side asset
 * pipeline — the stylesheet is self-contained by construction rather than by
 * configuration.
 *
 * FAIL-CLOSED
 *
 * Exits non-zero rather than shipping a half-built stylesheet: if an SVG is
 * missing, is not a plain self-contained SVG, or references anything external;
 * if the manifest and the files disagree; or if the emitted block does not end
 * up covering every declared class.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const iconsDir = join(packageRoot, 'planner-assets', 'icons');
const stylesheet = join(packageRoot, 'dist-full', 'index.css');

const fail = (message) => {
	console.error(`planner-icons: ${message}`);
	process.exit(1);
};

const spec = JSON.parse(readFileSync(join(iconsDir, 'icons.json'), 'utf8'));
if (!Array.isArray(spec.icons) || spec.icons.length === 0) {
	fail('icons.json declares no icons');
}

/**
 * A plain, self-contained SVG and nothing else.
 *
 * The whole point of inlining is that the stylesheet cannot reach off-origin at
 * run time, so an `<image>`, an `xlink:href`, a `<use>` pointing elsewhere or a
 * `url(http…)` inside the drawing would defeat it silently.
 */
function assertSelfContained(name, svg) {
	if (!/^<svg[\s>]/.test(svg.trim())) fail(`${name} does not start with <svg>`);
	if (!svg.includes('viewBox=')) fail(`${name} has no viewBox`);
	for (const forbidden of [
		'<image',
		'xlink:href',
		'<use',
		'<script',
		'<foreignObject',
		'@import',
		'http://',
		'https://',
	]) {
		// The xmlns declaration is the one legitimate "http://" in an SVG.
		const withoutXmlns = svg.replace(/xmlns(:\w+)?="[^"]*"/g, '');
		if (withoutXmlns.includes(forbidden)) {
			fail(`${name} contains ${forbidden}, which would make the icon load something at run time`);
		}
	}
}

/**
 * Percent-encode an SVG for a `url("data:image/svg+xml,…")` value.
 *
 * Only the characters that would end the CSS string, end the url() token or
 * start a fragment are escaped — the result stays readable in a diff, which a
 * base64 blob would not.
 */
function dataUri(svg) {
	const compact = svg.replace(/\s*\n\s*/g, ' ').trim();
	const encoded = compact.replace(/[%#<>?"'{}|\\^`\[\]]/g, (character) =>
		'%' + character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
	);
	return `data:image/svg+xml,${encoded}`;
}

const files = [];
const declarations = [];
const classes = [];

for (const icon of spec.icons) {
	const svg = readFileSync(join(iconsDir, icon.file), 'utf8');
	assertSelfContained(icon.file, svg);
	files.push({
		file: icon.file,
		class: icon.class,
		sha256: createHash('sha256').update(svg).digest('hex'),
		bytes: Buffer.byteLength(svg),
	});
	classes.push(icon.class);
	declarations.push(
		`.${icon.class}{--wx-planner-icon:url("${dataUri(svg)}")}`
	);
}

if (new Set(classes).size !== classes.length) {
	fail('icons.json declares the same class twice');
}

/**
 * The block appended to the built stylesheet.
 *
 * Sizing is per usage rather than one blanket rule, because these five icons
 * live in boxes upstream sized for a font glyph and each box states its own
 * height: 16px for the grid toggle and the action icon, 14px for the link
 * delete button, 24px for the splitter handle. Centring the 1em mask inside
 * the box the element already has keeps every one of those boxes exactly the
 * size it is today, so no row, cell or button changes height.
 */
const block = [
	'/* SVAR Production Planner: local icons, replacing the wxi icon font. */',
	...declarations,
	// The glyph itself. `currentColor` is what makes every existing colour rule
	// keep working; `contain` keeps the drawing inside the 1em box.
	`.${classes.join('::before,.')}::before{content:"";display:block;width:1em;height:1em;` +
		'background-color:currentColor;' +
		'-webkit-mask-image:var(--wx-planner-icon);mask-image:var(--wx-planner-icon);' +
		'-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;' +
		'-webkit-mask-position:center;mask-position:center;' +
		'-webkit-mask-size:contain;mask-size:contain}',
	// Centre the 1em glyph box inside the box upstream already gave the element,
	// so the element's own width/height stay exactly what they are today.
	`.${classes.join(',.')}{display:flex;align-items:center;justify-content:center}`,
	// The action icon is the one element upstream never gave a width: with a
	// font, the glyph's own advance supplied it. Restore that, centred, so the
	// action column keeps its centred control instead of a zero-width one.
	'.wx-action-icon.wxi-plus{width:1em;margin-left:auto;margin-right:auto}',
	// The link delete button states its height as a line-height; make it a real
	// height now that the content is a block rather than a text glyph.
	'.wx-delete-button-icon.wxi-close{height:14px}',
	// Same for the splitter handle, whose chip height came from line-height:24px.
	'.wx-button-expand-content i.wxi-menu-left,.wx-button-expand-content i.wxi-menu-right{height:24px}',
].join('');

const css = readFileSync(stylesheet, 'utf8');

if (css.includes('--wx-planner-icon')) {
	fail('the stylesheet already carries an icon block; the build is not idempotent from a dirty dist');
}

/*
 * The classes this block claims to draw must be classes the built renderer
 * actually emits, or the manifest has drifted away from the code.
 *
 * Most of them appear verbatim in the built JavaScript (the stylesheet only
 * POSITIONS a few of them). One does not: the grid row toggle composes its
 * class from a template literal, `wxi-menu-${open ? 'down' : 'right'}`, so
 * "wxi-menu-down" is never a literal anywhere. That icon declares a `stem` in
 * icons.json and is checked against it — a deliberately weaker check, written
 * down rather than quietly allowed.
 */
const renderer =
	readFileSync(join(packageRoot, 'dist', 'index.es.js'), 'utf8') + css;
for (const icon of spec.icons) {
	const probe = renderer.includes(icon.class) ? icon.class : icon.stem;
	if (!probe || !renderer.includes(probe)) {
		fail(
			`${icon.class} is declared in icons.json but the built renderer emits neither it ` +
				`nor its declared stem; the renderer no longer uses it, or the name is wrong`
		);
	}
}

const rewritten = css + block;
for (const name of classes) {
	if (!rewritten.includes(`.${name}{--wx-planner-icon:url("data:image/svg+xml,`)) {
		fail(`${name} did not get an icon declaration`);
	}
}

writeFileSync(stylesheet, rewritten);

/*
 * The per-file hashes are computed above but deliberately not written to a
 * second manifest: the icons are INSIDE `dist-full/index.css`, and the consumer
 * already hashes that whole file in `scripts/svar-fork-provenance.json`. A
 * separate icons manifest would be a second provenance record that the package
 * does not even publish, and two records that can disagree are worse than one.
 * They are logged instead, so a build transcript still shows what went in.
 */
for (const entry of files) {
	console.log(`planner-icons:   ${entry.class}  ${entry.file}  sha256 ${entry.sha256}`);
}

console.log(
	`planner-icons: ${classes.length} local SVG icons inlined (${classes.join(', ')})`
);

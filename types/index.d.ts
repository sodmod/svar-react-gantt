import type {
  FC,
  ReactNode,
  ComponentProps,
  ForwardRefExoticComponent,
  RefAttributes,
} from 'react';
import { ContextMenu as BaseContextMenu } from '@svar-ui/react-menu';
import { Toolbar as BaseToolbar } from '@svar-ui/react-toolbar';
import { Editor as BaseEditor } from '@svar-ui/react-editor';
import {
  HeaderMenu as BaseHeaderMenu,
  IColumnConfig as ITableColumn,
} from '@svar-ui/react-grid';

import type {
  TMethodsConfig,
  IApi,
  IConfig,
  ITask,
  ILink,
  IResource,
  IGanttColumn,
  IResourceColumn,
  IResourceLoad,
} from '@svar-ui/gantt-store';

export * from '@svar-ui/gantt-store';
export { registerEditorItem } from '@svar-ui/react-editor';

// SVAR-M4 (SVAR Production Planner): one timeline annotation — a vertical
// line at `date`'s column plus a labelled chip in the annotation lane under
// the scale rows. The renderer draws the line on the column's left edge for
// 'unit-start' (the coordinate a bar begins on) or on its centre for
// 'unit-center', puts the chip beside the line ('after': to the right, falling
// back to the left at the range edge) or centred on it ('center'), merges the
// lines of annotations sharing one x into one striped line, and adds `css` to
// every element it renders for the annotation so the consumer's own stylesheet
// colours it. What the annotation MEANS is the consumer's business, never this
// package's.
export interface ITimelineAnnotation {
  id: string | number;
  date: Date;
  anchor?: 'unit-start' | 'unit-center';
  /** The chip's visible text. */
  label: string;
  /** The full name exposed on hover/focus and as the chip's accessible name; defaults to `label`. */
  title?: string;
  labelPosition?: 'after' | 'center';
  css?: string;
}

export interface IColumnConfig extends Omit<IGanttColumn, 'header'> {
  cell?: ITableColumn['cell'];
  header?: ITableColumn['header'];
  editor?: ITableColumn['editor'];
}

export declare const Gantt: ForwardRefExoticComponent<
  {
    columns?: false | IColumnConfig[];
    taskTemplate?: FC<{
      data: ITask;
      api: IApi;
      onaction: (ev: { action: string; data: { [key: string]: any } }) => void;
    }>;
    readonly?: boolean;
    cellBorders?: 'column' | 'full';
    highlightTime?: (date: Date, unit: 'day' | 'hour') => string;
    // SVAR-M3 (SVAR Production Planner): a generic accessible-name seam for
    // scale cells (any `scales` unit — month/week/day/hour/...), modelled on
    // `highlightTime` above. Called per rendered cell; the returned string
    // (or undefined/'' for no override) becomes that cell's `aria-label`.
    scaleCellAriaLabel?: (
      date: Date,
      unit: string,
      value: string,
    ) => string | undefined;
    // SVAR-M4 (SVAR Production Planner): timeline annotations — lines at
    // dates in the chart body and their chips in the annotation lane, see
    // `ITimelineAnnotation` above.
    timelineAnnotations?: ITimelineAnnotation[];
    init?: (api: IApi) => void;
  } & IConfig &
    GanttActions<TMethodsConfig> &
    RefAttributes<IApi>
>;

export declare const HeaderMenu: FC<
  ComponentProps<typeof BaseHeaderMenu> & {
    api?: IApi;
  }
>;

export declare const ContextMenu: FC<
  ComponentProps<typeof BaseContextMenu> & {
    api?: IApi;
  }
>;

export declare const Toolbar: FC<
  ComponentProps<typeof BaseToolbar> & {
    api?: IApi;
  }
>;

export declare const Editor: FC<
  ComponentProps<typeof BaseEditor> & {
    api?: IApi;
  }
>;

type TooltipContentData =
  | { task: ITask; segmentIndex: number | null }
  | { link: ILink }
  | { rollup: ITask }
  | { resource: IResource };

export declare const Tooltip: FC<{
  content?: FC<{
    api: IApi;
    data: TooltipContentData;
  }>;
  api?: IApi;
  children?: ReactNode;
}>;

export declare const ResourceLoad: FC<{
  api?: IApi;
  columns?: IResourceColumn[];
  mode?: 'grid' | 'chart';
  template?: (load: IResourceLoad) => string;
}>;

export declare const Fullscreen: FC<{
  hotkey?: string;
  children?: ReactNode;
}>;

export declare const Material: FC<{
  fonts?: boolean;
  children?: ReactNode;
}>;

export declare const Willow: FC<{
  fonts?: boolean;
  children?: ReactNode;
}>;

export declare const WillowDark: FC<{
  fonts?: boolean;
  children?: ReactNode;
}>;

/* get component events from store actions*/
type RemoveHyphen<S extends string> = S extends `${infer Head}-${infer Tail}`
  ? `${Head}${RemoveHyphen<Tail>}`
  : S;

type EventName<K extends string> = `on${RemoveHyphen<K>}`;

export type GanttActions<TMethodsConfig extends Record<string, any>> = {
  [K in keyof TMethodsConfig as EventName<K & string>]?: (
    ev: TMethodsConfig[K],
  ) => void;
} & {
  [key: `on${string}`]: (ev?: any) => void;
};

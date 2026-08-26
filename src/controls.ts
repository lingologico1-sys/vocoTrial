/**
 * The two class strings every form control on this rig is dressed in.
 *
 * Here rather than in one of the panels because the prompt editor and the
 * settings fields are now mounted on two pages each, and a control that looked
 * like a control on tutorBench and like something else on studio would make one
 * shared component read as two. There is no design system to put this in and
 * inventing one for two strings would be worse; this is the whole of it.
 */

export const SELECT_CLASS =
  'rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-sm text-slate-200 outline-none disabled:opacity-40';

export const ACTION_CLASS =
  'text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline disabled:opacity-40 disabled:no-underline disabled:hover:text-slate-500';

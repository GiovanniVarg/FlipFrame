export type WorkflowAction='open_alternatives'|'select_object'|'draw_polygon'|'track_object'|'fix_outline'|'protect_area'|'compare_candidate'|'review_range'|'new_video';
export const EDITOR_WORKFLOWS:Record<WorkflowAction,{title:string,command:string,uiAction:string,description:string,criterion:string,candidate?:boolean}>;

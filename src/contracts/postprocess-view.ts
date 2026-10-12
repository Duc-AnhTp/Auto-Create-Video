import {z} from 'zod';
export const PostprocessViewSchema=z.object({stagesCompleted:z.array(z.string()).optional(),artifacts:z.object({finalDeliveryMasterPath:z.string().optional(),lutCubePath:z.string().optional(),cdlXmlPath:z.string().optional(),spatialFoleyStemPath:z.string().optional(),qcReportPath:z.string().optional()}).optional()});
export type PostprocessView=z.infer<typeof PostprocessViewSchema>;

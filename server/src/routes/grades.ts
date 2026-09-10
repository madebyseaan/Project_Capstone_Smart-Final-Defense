import { Router } from "express";
import registerClasses from "./grades-sub/classes";
import registerDashboard from "./grades-sub/dashboard";
import registerEditRequests from "./grades-sub/editRequests";
import registerAims from "./grades-sub/aims";
import registerEcr from "./grades-sub/ecr";

const router = Router();

registerClasses(router);
registerDashboard(router);
registerEditRequests(router);
registerAims(router);
registerEcr(router);

// Re-export named symbols so any existing imports from "grades" still work
export {
  resolveCurrentTerm,
  resolveEffectiveWeightsForClassAssignment,
} from "./grades-sub/helpers";

export type {
  EffectiveWeights,
  GradeDeadlineInfo,
} from "./grades-sub/helpers";

export default router;

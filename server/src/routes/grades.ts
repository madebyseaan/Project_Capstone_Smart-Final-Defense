import { Router } from "express";
import registerClasses from "./grades-sub/classes";
import registerDashboard from "./grades-sub/dashboard";
import registerEditRequests from "./grades-sub/editRequests";

const router = Router();

registerClasses(router);
registerDashboard(router);
registerEditRequests(router);

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

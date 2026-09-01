import { Router } from "express";

import dashboard from "./admin-sub/dashboard";
import system from "./admin-sub/system";
import users from "./admin-sub/users";
import audit from "./admin-sub/audit";
import grading from "./admin-sub/grading";
import classAssignments from "./admin-sub/classAssignments";

const router = Router();

dashboard(router);
system(router);
users(router);
audit(router);
grading(router);
classAssignments(router);

export default router;

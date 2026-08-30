import { Router } from "express";
import registerMainRoutes from "./registrar/main";
import registerFormRoutes from "./registrar/forms";
import registerExportRoutes from "./registrar/exports";
import registerEosyRoutes from "./registrar/eosy";

const router = Router();

registerMainRoutes(router);
registerFormRoutes(router);
registerExportRoutes(router);
registerEosyRoutes(router);

export default router;

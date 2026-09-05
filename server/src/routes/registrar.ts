import { Router } from "express";
import registerMainRoutes from "./registrar/main";
import registerFormRoutes from "./registrar/forms";
import registerExportRoutes from "./registrar/exports";
import registerEosyRoutes from "./registrar/eosy";
import registerAtlasRoutes from "./registrar/atlas";
import registerRemedialRoutes from "./registrar/remedial";
import registerTransfereeRoutes from "./registrar/transferees";

const router = Router();

registerMainRoutes(router);
registerFormRoutes(router);
registerExportRoutes(router);
registerEosyRoutes(router);
registerAtlasRoutes(router);
registerRemedialRoutes(router);
registerTransfereeRoutes(router);

export default router;

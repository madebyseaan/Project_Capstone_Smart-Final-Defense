import { Router } from "express";
import registerMainRoutes from "./registrar/main";
import registerFormRoutes from "./registrar/forms";
import registerExportRoutes from "./registrar/exports";
import registerEosyRoutes from "./registrar/eosy";
import registerRemedialRoutes from "./registrar/remedial";
import registerTransfereeRoutes from "./registrar/transferees";
import registerExternalRecordRoutes from "./registrar/externalRecords";
import registerSf10ProfileRoutes from "./registrar/sf10Profile";

const router = Router();

registerMainRoutes(router);
registerFormRoutes(router);
registerExportRoutes(router);
registerEosyRoutes(router);
registerRemedialRoutes(router);
registerTransfereeRoutes(router);
registerExternalRecordRoutes(router);
registerSf10ProfileRoutes(router);

export default router;

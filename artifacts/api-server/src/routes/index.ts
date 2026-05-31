import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tallerRouter from "./taller";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tallerRouter);

export default router;

import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tallerRouter from "./taller";
import authRouter from "./auth";
import usersRouter from "./users";
import rolesRouter from "./roles";
import todosRouter from "./todos";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(rolesRouter);
router.use(tallerRouter);
router.use(todosRouter);

export default router;

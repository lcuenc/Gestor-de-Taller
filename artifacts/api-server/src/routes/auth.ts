import { Router, type IRouter } from "express";
import { LoginBody, LoginResponse, GetCurrentUserResponse, LogoutResponse } from "@workspace/api-zod";
import { verifyCredentials, getSessionContext, sessionDTO } from "../lib/auth";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(401).json({ error: "Usuario o contraseña inválidos" });
    return;
  }
  const ctx = await verifyCredentials(parsed.data.username, parsed.data.password);
  if (!ctx) {
    res.status(401).json({ error: "Usuario o contraseña inválidos" });
    return;
  }
  req.session.userId = ctx.user.id;
  res.json(LoginResponse.parse(sessionDTO(ctx)));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await new Promise<void>((resolve) => {
    req.session.destroy(() => resolve());
  });
  res.clearCookie("connect.sid");
  res.json(LogoutResponse.parse({ status: "ok" }));
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const ctx = await getSessionContext(req);
  if (!ctx) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  res.json(GetCurrentUserResponse.parse(sessionDTO(ctx)));
});

export default router;

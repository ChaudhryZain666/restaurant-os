import { Router } from "express";
import { authRouter } from "./auth.routes.js";
import { menuRouter } from "./menu.routes.js";
import { orderRouter } from "./order.routes.js";
import { loyaltyRouter } from "./loyalty.routes.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/menu", menuRouter);
apiRouter.use("/orders", orderRouter);
apiRouter.use("/loyalty", loyaltyRouter);

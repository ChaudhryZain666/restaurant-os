import { Router } from "express";
import { authRouter } from "./auth.routes.js";
import { restaurantRouter } from "./restaurant.routes.js";
import { categoryRouter } from "./category.routes.js";
import { menuRouter } from "./menu.routes.js";
import { modifierRouter } from "./modifier.routes.js";
import { orderRouter } from "./order.routes.js";
import { restaurantOrderRouter } from "./restaurantOrder.routes.js";
import { loyaltyRouter } from "./loyalty.routes.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/orders", orderRouter);
apiRouter.use("/restaurants", restaurantRouter);
apiRouter.use("/restaurants/:restaurantId/categories", categoryRouter);
apiRouter.use("/restaurants/:restaurantId/menu", menuRouter);
apiRouter.use("/restaurants/:restaurantId/menu/:menuItemId/modifiers", modifierRouter);
apiRouter.use("/restaurants/:restaurantId/orders", restaurantOrderRouter);
apiRouter.use("/restaurants/:restaurantId/loyalty", loyaltyRouter);

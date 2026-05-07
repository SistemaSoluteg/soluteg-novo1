import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";

import { authRouter } from "./routers/auth.router";
import { reportsRouter } from "./routers/reports.router";
import { usersRouter } from "./routers/users.router";
import { adminAuthRouter } from "./routers/adminAuth.router";
import { clientsRouter } from "./routers/clients.router";
import { documentsRouter } from "./routers/documents.router";
import { clientProfileRouter } from "./routers/clientProfile.router";
import { adminProfileRouter } from "./routers/adminProfile.router";
import { adminDocumentsRouter } from "./routers/adminDocuments.router";
import { workOrdersRouter } from "./routers/workOrders.router";
import { checklistsRouter } from "./routers/checklists.router";
import { budgetsRouter } from "./routers/budgets.router";
import { techniciansRouter } from "./routers/technicians.router";
import { technicianPortalRouter } from "./routers/technicianPortal.router";
import { waterTankMonitoringRouter } from "./routers/waterTankMonitoring.router";
import { waterTankAdminRouter } from "./routers/waterTankAdmin.router";
import { pdvRouter } from "./routers/pdv.router";
import { laudosRouter } from "./routers/laudos.router";
import { whatsappRouter } from "./routers/whatsapp.router";
import { pushSubscriptionsRouter } from "./routers/pushSubscriptions";

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  reports: reportsRouter,
  users: usersRouter,
  adminAuth: adminAuthRouter,
  clients: clientsRouter,
  documents: documentsRouter,
  clientProfile: clientProfileRouter,
  adminProfile: adminProfileRouter,
  adminDocuments: adminDocumentsRouter,
  workOrders: workOrdersRouter,
  checklists: checklistsRouter,
  budgets: budgetsRouter,
  technicians: techniciansRouter,
  technicianPortal: technicianPortalRouter,
  waterTankMonitoring: waterTankMonitoringRouter,
  waterTankAdmin: waterTankAdminRouter,
  pdv: pdvRouter,
  laudos: laudosRouter,
  whatsapp: whatsappRouter,
  pushSubscriptions: pushSubscriptionsRouter,
});

export type AppRouter = typeof appRouter;

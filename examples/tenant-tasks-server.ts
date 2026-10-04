import { createExpressServer } from "../express"
import { tenantTasksApp } from "./tenant-tasks"

const port = Number(process.env.PORT ?? 3002)

createExpressServer(tenantTasksApp)
  .listen(port)
  .then(() => console.log(`Tenant task demo listening at http://localhost:${port}`))

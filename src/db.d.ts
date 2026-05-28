import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
export declare const prisma: PrismaClient<{
    adapter: PrismaBetterSqlite3;
}, never, import("@prisma/client/runtime/client").DefaultArgs>;
//# sourceMappingURL=db.d.ts.map
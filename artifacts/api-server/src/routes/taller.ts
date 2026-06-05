import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, tallerStateTable } from "@workspace/db";
import { SaveTallerStateBody, GetTallerStateResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const DEFAULT_TECNICOS = [
  "LUKAS ROBERTO GUILLER","KASPARIAN CHRISTIAN G","TWERDOCHLIB CLAUDIO",
  "GONZALEZ JOSE","VERA ABEL DOLORES","SZAPLAY MATIAS","PEREIRO RODOLFO",
  "URQUIA LUCAS AGUSTIN","SANSOGNE HERNAN ALBERTO","RIVERO CHANIL ALAN",
  "GIMENEZ MARCOS","CABAÑA JESUS","DE LA FUENTE ERIK","LASTRETTI ALAN",
  "HUANCA FACUNDO","CASTRO NEGUEN","RAMIREZ ALEX",
];

router.get("/taller/state", async (req, res): Promise<void> => {
  const rows = await db.select().from(tallerStateTable).limit(1);
  if (!rows.length) {
    res.json(GetTallerStateResponse.parse({
      equipos: [],
      gpvList: [],
      tecnicos: DEFAULT_TECNICOS,
      layout: {},
      updatedAt: null,
    }));
    return;
  }
  const row = rows[0];
  res.json(GetTallerStateResponse.parse({
    equipos: row.equipos,
    gpvList: row.gpvList,
    tecnicos: row.tecnicos,
    layout: row.layout ?? {},
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }));
});

router.put("/taller/state", async (req, res): Promise<void> => {
  const parsed = SaveTallerStateBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid taller state body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { equipos, gpvList, tecnicos, layout } = parsed.data;
  const existing = await db.select().from(tallerStateTable).limit(1);

  let row;
  if (existing.length) {
    const updated = await db
      .update(tallerStateTable)
      .set({ equipos, gpvList, tecnicos, layout })
      .where(eq(tallerStateTable.id, existing[0].id))
      .returning();
    row = updated[0];
  } else {
    const inserted = await db
      .insert(tallerStateTable)
      .values({ equipos, gpvList, tecnicos, layout })
      .returning();
    row = inserted[0];
  }

  res.json(GetTallerStateResponse.parse({
    equipos: row.equipos,
    gpvList: row.gpvList,
    tecnicos: row.tecnicos,
    layout: row.layout ?? {},
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }));
});

export default router;

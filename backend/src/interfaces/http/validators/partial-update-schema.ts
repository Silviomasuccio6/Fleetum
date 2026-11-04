import { z } from "zod";

// Zod 4 applies nested defaults inside optional properties. A partial update
// must preserve absent values. The undefined-first branch prevents evaluating
// a create default; the outer optional also declares that the key may be absent.
export const partialUpdateSchema = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) => {
  const fields = Object.fromEntries(Object.entries(schema.shape).map(([key, field]) =>
    [key, z.union([z.undefined(), field]).optional()]
  )) as { [K in keyof T]: z.ZodOptional<z.ZodUnion<readonly [z.ZodUndefined, T[K]]>> };
  return z.object(fields);
};

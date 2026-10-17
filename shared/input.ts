import { z } from "zod";

export const inputSchema = z.object({
  binaryPath: z.string().optional(),
  token: z.string().optional(),
});

export type AntigravityUsageInput = z.infer<typeof inputSchema>;

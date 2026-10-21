import type { ValidatorAdapter } from '@tanstack/react-router'
import type { z } from 'zod'

/**
 * Adapta un esquema Zod al formato de validadores de TanStack Router,
 * conservando la inferencia de tipos del lado del cliente.
 */
export function validar<T extends z.ZodType>(
  schema: T,
): ValidatorAdapter<z.input<T>, z.output<T>> {
  return {
    types: {
      input: undefined as unknown as z.input<T>,
      output: undefined as unknown as z.output<T>,
    },
    parse: (value: unknown) => schema.parse(value) as z.output<T>,
  }
}

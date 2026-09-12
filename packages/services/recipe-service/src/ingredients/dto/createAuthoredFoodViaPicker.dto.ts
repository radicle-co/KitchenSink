import { createZodDto } from 'nestjs-zod';

import { createAuthoredFoodViaPickerRequestSchema } from '../ingredients.schema.js';

/** Body of `POST /api/v1/ingredients/authored-food` (plan U16). */
export class CreateAuthoredFoodViaPickerDto extends createZodDto(createAuthoredFoodViaPickerRequestSchema) {}

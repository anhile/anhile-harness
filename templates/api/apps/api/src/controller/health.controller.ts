import { Controller, Get } from '@nestjs/common';

/**
 * Layer: controller. The first route, and a real one — something has to
 * answer before a deployment can be called up.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

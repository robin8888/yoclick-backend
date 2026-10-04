import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { PinoLogger } from 'nestjs-pino';
import { describeErrorForLog } from './describe-error-for-log';
import { mapExceptionToProblem } from './map-exception-to-problem';

const PROBLEM_CONTENT_TYPE = 'application/problem+json';
const FIRST_SERVER_ERROR_STATUS = 500;

/**
 * Único punto donde una excepción se convierte en respuesta HTTP (SEC-61): Problem Details,
 * sin trazas ni SQL. Los errores inesperados se registran con el mismo `traceId` que ve el cliente
 * para poder encontrarlos sin exponer nada.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const request = httpContext.getRequest<FastifyRequest>();
    const reply = httpContext.getResponse<FastifyReply>();

    const problem = mapExceptionToProblem(exception, request.id);
    if (problem.status >= FIRST_SERVER_ERROR_STATUS) {
      this.logger.error(
        { traceId: request.id, ...describeErrorForLog(exception) },
        'Unhandled error',
      );
    }

    void reply.status(problem.status).header('content-type', PROBLEM_CONTENT_TYPE).send(problem);
  }
}

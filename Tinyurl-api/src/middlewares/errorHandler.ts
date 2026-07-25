import { type Request, type Response, type NextFunction } from 'express';
import { type BaseError, logger } from 'shared';

const errorHandler = (err: BaseError, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err.statusCode ? err.statusCode : 500;

  res.status(statusCode);

  logger.error(`Error: ${err.message}`, {
    statusCode: err.statusCode,
    data: err.data,
    stack: err.stack,
  });

  res.json({
    message: err.message,
    status: false,
  });
};

export default errorHandler;

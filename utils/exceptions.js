/**
 * Custom Exception Classes
 * For tournament system error handling
 */

class ValidationException extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'ValidationException';
    this.field = field;
    this.status = 400;
  }
}

class NetworkException extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'NetworkException';
    this.status = statusCode;
  }
}

class TournamentException extends Error {
  constructor(message, code = 'TOURNAMENT_ERROR') {
    super(message);
    this.name = 'TournamentException';
    this.code = code;
    this.status = 400;
  }
}

class PrizeException extends Error {
  constructor(message, code = 'PRIZE_ERROR') {
    super(message);
    this.name = 'PrizeException';
    this.code = code;
    this.status = 400;
  }
}

module.exports = {
  ValidationException,
  NetworkException,
  TournamentException,
  PrizeException
};

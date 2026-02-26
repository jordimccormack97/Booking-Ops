import { Router } from "express";
import { BookingsRepository } from "../db/bookings-repository";

/**
 * Creates booking query routes.
 */
export function createBookingsRouter(bookingsRepository: BookingsRepository) {
  const router = Router();

  router.get("/", (_req, res) => {
    const bookings = bookingsRepository.list();
    return res.json(bookings);
  });

  return router;
}

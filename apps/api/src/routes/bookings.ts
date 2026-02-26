import { Router } from "express";
import { BookingService } from "../services/booking.service";

/**
 * Creates booking query routes.
 */
export function createBookingsRouter(bookingService: BookingService) {
  const router = Router();

  router.get("/", (_req, res) => {
    const bookings = bookingService.list();
    return res.json(bookings);
  });

  return router;
}

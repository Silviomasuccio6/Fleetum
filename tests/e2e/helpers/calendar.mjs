const monthIndex = (month) => {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid planner month");
  const [year, value] = month.split("-").map(Number);
  return year * 12 + value - 1;
};

export function calendarMonthSteps(currentMonth, targetMonth) {
  const current = monthIndex(currentMonth);
  const target = monthIndex(targetMonth);
  if (Math.abs(target - current) > 12) throw new Error("Planner month distance exceeds the synthetic fixture range");
  const direction = Math.sign(target - current);
  const steps = [];
  for (let index = current; index !== target;) {
    index += direction;
    steps.push({ month: `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`,
      button: direction > 0 ? "Mese successivo" : "Mese precedente" });
  }
  return steps;
}

/** Use the actual API month and the browser's local pickup month, then await each load. */
export async function openBookingMonth(page, pickupAt, currentMonth) {
  const targetMonth = await page.evaluate((value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error("Invalid booking pickup date");
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }, pickupAt);
  for (const step of calendarMonthSteps(currentMonth, targetMonth)) {
    const loaded = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET" && url.pathname === "/api/rental-bookings/availability/month"
        && url.searchParams.get("month") === step.month;
    });
    await page.getByRole("button", { name: step.button, exact: true }).click();
    const response = await loaded;
    if (!response.ok() || (await response.json()).month !== step.month) throw new Error("Booking planner month did not load");
  }
  return targetMonth;
}

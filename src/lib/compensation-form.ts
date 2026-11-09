// Reads the shared allowances / mileage / bonus fields from a form (client- and server-safe).
const MEALS = ["meal_breakfast", "meal_lunch", "meal_dinner"] as const;

export function readCompensationForm(fd: FormData) {
  const str = (k: string) => String(fd.get(k) ?? "").trim();
  return {
    mealsEnabled: fd.get("mealsEnabled") === "on",
    perDiemEnabled: fd.get("perDiemEnabled") === "on",
    mileageEnabled: fd.get("mileageEnabled") === "on",
    bonusEnabled: fd.get("bonusEnabled") === "on",
    breakfast: str("breakfast"),
    lunch: str("lunch"),
    dinner: str("dinner"),
    perDiem: str("perDiem"),
    mileageRate: str("mileageRate"),
    eligibleMeals: MEALS.filter((m) => fd.get(`eligible_${m}`) === "on"),
    bonusAmount: str("bonusAmount"),
    bonusConditions: str("bonusConditions"),
    notes: str("compNotes"),
  };
}

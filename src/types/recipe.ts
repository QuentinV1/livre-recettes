export interface Ingredient {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  fromPantry?: boolean; // true = "À ajouter vous-même", false/undefined = dans la box
}

export interface NutritionRow {
  label: string;
  perServing: string;
  per100g: string;
}

export interface RecipeStep {
  title?: string;
  bullets: string[];
  chefTip?: string;
}

export interface RecipeRating {
  score: number; // 1..5 (entier)
  userName: string;
  updatedAt: string;
}

export interface SharedBookMember {
  uid: string;
  displayName: string;
  email?: string;
  joinedAt: string;
}

export interface SharedBook {
  id: string;
  name: string;
  ownerUid: string;
  memberUids: string[];
  members: Record<string, SharedBookMember>;
  createdAt: string;
  updatedAt: string;
}

export interface Recipe {
  id: string;
  title: string;
  subtitle?: string;
  prepTimeMinutes: number;
  prepTimeRange?: string; // ex: "35 - 45 min"
  servings: number;
  tags: string[];
  utensils?: string[];
  ingredients: Ingredient[];
  steps: string[];
  stepDetails?: RecipeStep[];
  nutrition?: NutritionRow[];
  allergens?: string;
  imageFront?: string; // Photo recto (plat) - Data URL compressée
  imageBack?: string;  // Photo verso (fiche texte) - Data URL compressée
  notes?: string;
  ratings?: Record<string, RecipeRating>; // Clé = uid Firebase (ou 'local')
  ownerUid?: string; // UID du propriétaire de la recette (notamment dans un foyer)
  ownerName?: string; // Nom affiché du propriétaire
  isWeekly: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DayOfWeek =
  | 'lundi'
  | 'mardi'
  | 'mercredi'
  | 'jeudi'
  | 'vendredi'
  | 'samedi'
  | 'dimanche';

export type MealSlot = 'midi' | 'soir';

export interface DayPlan {
  midi: string | null; // recipeId
  soir: string | null; // recipeId
  midiServings?: number;
  soirServings?: number;
}

export type WeeklyPlan = Record<DayOfWeek, DayPlan>;

export interface RecipeBookBackup {
  version: number;
  exportedAt: string;
  recipes: Recipe[];
  weeklyPlan: WeeklyPlan;
}

export const DAYS_OF_WEEK: { key: DayOfWeek; label: string; short: string }[] = [
  { key: 'lundi', label: 'Lundi', short: 'Lun' },
  { key: 'mardi', label: 'Mardi', short: 'Mar' },
  { key: 'mercredi', label: 'Mercredi', short: 'Mer' },
  { key: 'jeudi', label: 'Jeudi', short: 'Jeu' },
  { key: 'vendredi', label: 'Vendredi', short: 'Ven' },
  { key: 'samedi', label: 'Samedi', short: 'Sam' },
  { key: 'dimanche', label: 'Dimanche', short: 'Dim' },
];

export const SUGGESTED_TAGS = [
  'rapide',
  'healthy',
  'végétarien',
  'pâte',
  'riz',
  'poulet',
  'poisson',
  'bœuf',
  'confort',
  'épicé',
  'classique',
  'world',
];

export const createEmptyWeeklyPlan = (): WeeklyPlan => ({
  lundi: { midi: null, soir: null },
  mardi: { midi: null, soir: null },
  mercredi: { midi: null, soir: null },
  jeudi: { midi: null, soir: null },
  vendredi: { midi: null, soir: null },
  samedi: { midi: null, soir: null },
  dimanche: { midi: null, soir: null },
});

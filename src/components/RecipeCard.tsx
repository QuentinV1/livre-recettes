import React from 'react';
import { Clock, Users, Star, CalendarPlus, ChefHat } from 'lucide-react';
import { Recipe } from '../types/recipe';

interface RecipeCardProps {
  recipe: Recipe;
  onOpen: (recipe: Recipe) => void;
  onToggleWeekly: (recipeId: string, e: React.MouseEvent) => void;
  onQuickPlan?: (recipe: Recipe, e: React.MouseEvent) => void;
}

export const RecipeCard: React.FC<RecipeCardProps> = ({
  recipe,
  onOpen,
  onToggleWeekly,
  onQuickPlan,
}) => {
  return (
    <article
      onClick={() => onOpen(recipe)}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-fresh-300 hover:shadow-md cursor-pointer"
    >
      {/* Image / Visuel */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-fresh-50">
        {recipe.imageFront ? (
          <img
            src={recipe.imageFront}
            alt={recipe.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-fresh-50 to-fresh-100 text-fresh-600">
            <ChefHat className="h-10 w-10 opacity-70" />
            <span className="mt-1 text-xs font-medium text-fresh-700/80">Sans photo</span>
          </div>
        )}

        {/* Badges sur l'image */}
        <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-stone-800 shadow-sm backdrop-blur-sm">
            <Clock className="h-3.5 w-3.5 text-fresh-600" />
            {recipe.prepTimeMinutes} min
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-xs font-medium text-stone-700 shadow-sm backdrop-blur-sm">
            <Users className="h-3.5 w-3.5 text-stone-500" />
            {recipe.servings}
          </span>
        </div>

        {/* Bouton "Recette de la semaine" */}
        <button
          type="button"
          onClick={(e) => onToggleWeekly(recipe.id, e)}
          title={recipe.isWeekly ? 'Retirer des recettes de la semaine' : 'Ajouter aux recettes de la semaine'}
          className={`absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full shadow-sm backdrop-blur-sm transition-all ${
            recipe.isWeekly
              ? 'bg-amber-400 text-stone-900 hover:bg-amber-500'
              : 'bg-white/90 text-stone-400 hover:bg-white hover:text-amber-500'
          }`}
        >
          <Star className={`h-4 w-4 ${recipe.isWeekly ? 'fill-current' : ''}`} />
        </button>
      </div>

      {/* Contenu */}
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-base font-bold leading-snug text-stone-900 line-clamp-2 group-hover:text-fresh-700">
            {recipe.title}
          </h3>
        </div>

        {recipe.subtitle && (
          <p className="mt-1 text-xs text-stone-500 line-clamp-2">{recipe.subtitle}</p>
        )}

        {/* Tags */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {recipe.isWeekly && (
            <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
              Cette semaine
            </span>
          )}
          {recipe.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-md bg-fresh-50 px-2 py-0.5 text-[11px] font-medium text-fresh-800 ring-1 ring-inset ring-fresh-200/70"
            >
              #{tag}
            </span>
          ))}
          {recipe.tags.length > 3 && (
            <span className="inline-flex items-center rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-500">
              +{recipe.tags.length - 3}
            </span>
          )}
        </div>

        {/* Pied de carte */}
        <div className="mt-auto flex items-center justify-between pt-3 border-t border-stone-100 text-xs text-stone-500">
          <span>
            {recipe.ingredients.length} ingr. · {recipe.steps.length} étapes
          </span>
          {onQuickPlan && (
            <button
              type="button"
              onClick={(e) => onQuickPlan(recipe, e)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-fresh-700 hover:bg-fresh-50 transition-colors"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              Planifier
            </button>
          )}
        </div>
      </div>
    </article>
  );
};

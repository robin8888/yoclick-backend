import { Inject, Injectable } from '@nestjs/common';
import { distanceInKilometers, type GeoPoint } from '../domain/distance';
import {
  JOIN_REPOSITORY,
  type JoinRepository,
  type PublicCenterSummary,
} from './ports/join.repository';

const MAX_CANDIDATES = 200;
const MAX_RESULTS = 20;

export interface CenterSearch {
  readonly textQuery: string | null;
  readonly origin: GeoPoint | null;
}

export interface CenterSearchResult extends PublicCenterSummary {
  /** Solo cuando la búsqueda trae ubicación y el centro tiene coordenadas. */
  readonly distanceInKilometers: number | null;
}

/** Busca entre los centros que han elegido salir en el directorio. Con ubicación, los más cercanos primero. */
@Injectable()
export class SearchCentersUseCase {
  constructor(@Inject(JOIN_REPOSITORY) private readonly joins: JoinRepository) {}

  async execute(search: CenterSearch): Promise<CenterSearchResult[]> {
    const candidates = await this.joins.listListedCenters(search.textQuery, MAX_CANDIDATES);
    const results = candidates.map(({ latitude, longitude, ...summary }) => ({
      ...summary,
      distanceInKilometers:
        search.origin && latitude !== null && longitude !== null
          ? distanceInKilometers(search.origin, { latitude, longitude })
          : null,
    }));
    return search.origin
      ? sortByDistance(results).slice(0, MAX_RESULTS)
      : results.slice(0, MAX_RESULTS);
  }
}

function sortByDistance(results: CenterSearchResult[]): CenterSearchResult[] {
  return [...results].sort(
    (first, second) =>
      (first.distanceInKilometers ?? Infinity) - (second.distanceInKilometers ?? Infinity),
  );
}

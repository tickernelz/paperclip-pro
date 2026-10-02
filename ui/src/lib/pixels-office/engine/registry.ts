import { loadPixelAssets } from '../assetLoader';
import type { OfficeController } from '../officeModel';
import { OfficeControllerImpl } from './controller';

const MAX_LIVE_CONTROLLERS = 3;

const controllers = new Map<string, OfficeControllerImpl>();
const pending = new Map<string, Promise<OfficeController>>();

export function getOfficeController(companyId: string): Promise<OfficeController> {
  const existing = controllers.get(companyId);
  if (existing) return Promise.resolve(existing);

  const inFlight = pending.get(companyId);
  if (inFlight) return inFlight;

  const promise = loadPixelAssets()
    .then(({ layouts, cameraBounds }) => {
      pending.delete(companyId);
      const ready = controllers.get(companyId);
      if (ready) return ready;
      const controller = new OfficeControllerImpl(companyId, layouts.combined, cameraBounds);
      controllers.set(companyId, controller);
      while (controllers.size > MAX_LIVE_CONTROLLERS) {
        const oldest = controllers.keys().next();
        if (oldest.done || oldest.value === companyId) break;
        controllers.get(oldest.value)?.dispose();
        controllers.delete(oldest.value);
      }
      return controller;
    })
    .catch((error: unknown) => {
      pending.delete(companyId);
      throw error;
    });

  pending.set(companyId, promise);
  return promise;
}

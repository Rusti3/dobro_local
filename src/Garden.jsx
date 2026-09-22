import React, { lazy, Suspense, useState } from "react";
import { gardenFor } from "./garden-model.js";
import "./garden.css";

const GardenScene = lazy(() => import("./GardenScene.jsx"));

export default function Garden({ data }) {
  const [selected, setSelected] = useState(null);
  const garden = gardenFor(data.plans, data.user.id);
  const objects = garden.objects.length
    ? garden.objects
    : [{ id: "seed", species: "animals", seed: true }];

  return (
    <main className="garden-only-page" aria-label="Мой сад добрых дел">
      <Suspense fallback={<div className="garden-3d-loading">Собираем сад…</div>}>
        <GardenScene
          objects={objects.slice(0, 9)}
          selected={selected}
          onSelect={(id) => setSelected(selected === id ? null : id)}
        />
      </Suspense>
    </main>
  );
}

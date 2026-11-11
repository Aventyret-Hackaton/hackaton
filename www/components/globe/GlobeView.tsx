"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";

import { APP_TAGLINE, APP_TITLE, ARRIVAL_DAY, LEGS } from "@/lib/globe/journey";
import { VEHICLE_MODELS } from "@/lib/voxel/models";

import styles from "./GlobeView.module.css";
import { createGlobeScene } from "./scene";
import type { GlobeSceneHandle, GlobeStatus } from "./scene";
import { renderModelThumbnails } from "./thumbnails";

const ICON_SIZE = 64;

const SPIN_KEYS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

const HINTS: readonly (readonly [string, string])[] = [
  ["Mellanslag", "starta / pausa"],
  ["← → ↑ ↓", "snurra jordklotet"],
  ["+ −", "zooma"],
  ["N B", "nästa / förra etappen"],
  ["F", "följ resenären"],
  ["R", "börja om"],
  ["C", "scanlines av / på"],
];

const INITIAL_STATUS: GlobeStatus = {
  running: false,
  started: false,
  finished: false,
  follow: true,
};

export const GlobeView = (): ReactElement => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const currentStepRef = useRef<HTMLLIElement>(null);
  const sceneRef = useRef<GlobeSceneHandle | null>(null);
  const [legIndex, setLegIndex] = useState(0);
  const [status, setStatus] = useState<GlobeStatus>(INITIAL_STATUS);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [scanlines, setScanlines] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const labelLayer = labelLayerRef.current;
    if (!canvas || !labelLayer) return;
    const scene = createGlobeScene({
      canvas,
      labelLayer,
      sightLabelClassName: styles.sightLabel,
      hereLabelClassName: `${styles.sightLabel} ${styles.hereLabel}`,
      hereLabelText: "Här är du",
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches,
      onLegChange: setLegIndex,
      onStatusChange: setStatus,
    });
    sceneRef.current = scene;
    setIcons(renderModelThumbnails(Object.values(VEHICLE_MODELS), ICON_SIZE));
    return (): void => {
      sceneRef.current = null;
      scene.dispose();
    };
  }, []);

  useEffect(() => {
    const pressed = new Set<string>();
    const applySpin = (): void => {
      let x = 0;
      let y = 0;
      pressed.forEach((key) => {
        x += SPIN_KEYS[key][0];
        y += SPIN_KEYS[key][1];
      });
      sceneRef.current?.setSpin(x, y);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const scene = sceneRef.current;
      if (!scene) return;
      if (event.key in SPIN_KEYS) {
        pressed.add(event.key);
        applySpin();
      } else if (event.key === " ") {
        if (!event.repeat) scene.toggleRunning();
      } else if (event.key === "+" || event.key === "=") {
        scene.zoom(-1);
      } else if (event.key === "-") {
        scene.zoom(1);
      } else if (event.repeat) {
        return;
      } else if (event.key.toLowerCase() === "n") {
        scene.stepLeg(1);
      } else if (event.key.toLowerCase() === "b") {
        scene.stepLeg(-1);
      } else if (event.key.toLowerCase() === "f") {
        scene.toggleFollow();
      } else if (event.key.toLowerCase() === "r") {
        scene.restart();
      } else if (event.key.toLowerCase() === "c") {
        setScanlines((value) => !value);
      } else {
        return;
      }
      event.preventDefault();
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (pressed.delete(event.key)) applySpin();
    };

    const onBlur = (): void => {
      pressed.clear();
      applySpin();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return (): void => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    currentStepRef.current?.scrollIntoView({ block: "nearest" });
  }, [legIndex]);

  const leg = LEGS[legIndex];
  const statusText = status.finished
    ? `Dag ${ARRIVAL_DAY}. Framme. Nu då?`
    : status.started
      ? `Nu: ${leg.mode} · ${leg.from} → ${leg.to}`
      : "Tryck på mellanslag för att ge dig av.";

  return (
    <main className={`${styles.root} ${scanlines ? styles.scanlines : ""}`}>
      <header className={styles.header}>
        <span className={styles.stripes} aria-hidden="true" />
        <h1 className={styles.title}>{APP_TITLE}</h1>
        <span className={styles.stripes} aria-hidden="true" />
      </header>

      <section className={styles.panel} aria-label="Resedirektiv">
        <h2 className={styles.panelTitle}>Resedirektiv</h2>
        <ol className={styles.steps}>
          {LEGS.map((step, index) => {
            const current = index === legIndex && !status.finished;
            return (
              <li
                key={step.id}
                ref={current ? currentStepRef : undefined}
                className={`${styles.step} ${current ? styles.stepCurrent : ""}`}
                aria-current={current ? "step" : undefined}
              >
                {icons[step.modelId] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className={styles.icon}
                    src={icons[step.modelId]}
                    alt=""
                    width={ICON_SIZE}
                    height={ICON_SIZE}
                  />
                ) : (
                  <span className={styles.icon} />
                )}
                <div className={styles.stepText}>
                  <span className={styles.day}>Dag {step.startDay}</span>
                  <span className={styles.mode}>{step.mode}</span>
                  <span className={styles.instruction}>{step.instruction}</span>
                </div>
              </li>
            );
          })}
        </ol>
        <p className={styles.panelFooter}>Hålltider · resdag</p>
      </section>

      <section className={styles.stage} aria-label="Jordklotet">
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          aria-label="Voxeljordklot med resvägen västerut från Slussen till Slussen"
        />
        <div ref={labelLayerRef} className={styles.labels} />
        <ul className={styles.hints}>
          {HINTS.map(([keys, action]) => (
            <li key={keys}>
              <kbd>{keys}</kbd> {action}
            </li>
          ))}
        </ul>
        <p className={styles.status} aria-live="polite">
          {statusText}
        </p>
        <div className={styles.caption}>
          <span className={styles.captionRoute}>
            A <span className={styles.captionArrow}>→</span> B
          </span>
          <span>{APP_TAGLINE}</span>
        </div>
      </section>
    </main>
  );
};

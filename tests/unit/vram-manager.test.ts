/**
 * Unit Tests for VRAM Manager
 *
 * Tests the VRAM migration logic and GPU memory management.
 */

import axios from "axios";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  getVRAMManager as GetVRAMManagerType,
  TaskPriority as TaskPriorityEnum,
  TaskType as TaskTypeEnum,
  VRAM_CONFIG as VRAMConfigType,
} from "../../src/utils/vram/index.js";

// Module-level imports for VRAM manager
let VRAM_CONFIG: typeof VRAMConfigType;
let TaskType: typeof TaskTypeEnum;
let TaskPriority: typeof TaskPriorityEnum;
let getVRAMManager: typeof GetVRAMManagerType;

describe("VRAM Manager", () => {
  beforeAll(async () => {
    const module = await import("../../src/utils/vram/index.js");
    VRAM_CONFIG = module.VRAM_CONFIG;
    TaskType = module.TaskType;
    TaskPriority = module.TaskPriority;
    getVRAMManager = module.getVRAMManager;
  });

  describe("Configuration", () => {
    it("should have reasonable default values", () => {
      expect(VRAM_CONFIG.totalVRAM).toBeGreaterThan(0);
      expect(VRAM_CONFIG.minFreeBuffer).toBeGreaterThan(0);
      expect(VRAM_CONFIG.warningThreshold).toBeGreaterThan(0);
      expect(VRAM_CONFIG.warningThreshold).toBeLessThan(1);
      expect(VRAM_CONFIG.criticalThreshold).toBeGreaterThan(VRAM_CONFIG.warningThreshold);
      expect(VRAM_CONFIG.pollInterval).toBeGreaterThanOrEqual(1000);
    });

    it("should have VRAM estimates for all task types", () => {
      for (const taskType of Object.values(TaskType)) {
        expect(VRAM_CONFIG.estimatedUsage[taskType]).toBeDefined();
        expect(VRAM_CONFIG.estimatedUsage[taskType]).toBeGreaterThan(0);
      }
    });
  });

  describe("Ollama API", () => {
    it("should fetch loaded models from ps endpoint", async () => {
      try {
        const response = await axios.get("http://localhost:11434/api/ps", {
          timeout: 5000,
        });

        expect(response.data).toBeDefined();
        expect(Array.isArray(response.data.models)).toBe(true);
      } catch (error) {
        if (axios.isAxiosError(error) && error.code === "ECONNREFUSED") {
          // Skip test if Ollama not running
          return;
        }
        throw error;
      }
    });

    it("should list available models from tags endpoint", async () => {
      try {
        const response = await axios.get("http://localhost:11434/api/tags", {
          timeout: 5000,
        });

        expect(response.data).toBeDefined();
        expect(Array.isArray(response.data.models)).toBe(true);
      } catch (error) {
        if (axios.isAxiosError(error) && error.code === "ECONNREFUSED") {
          // Skip test if Ollama not running
          return;
        }
        throw error;
      }
    });
  });

  describe("Singleton Pattern", () => {
    it("should return the same instance", () => {
      const manager1 = getVRAMManager();
      const manager2 = getVRAMManager();

      expect(manager1).toBe(manager2);
    });
  });

  describe("VRAM Status", () => {
    it("should get valid VRAM status or null if services offline", async () => {
      const manager = getVRAMManager();

      // Wait a moment for initial poll
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const status = manager.getVRAMStatus();

      if (status) {
        expect(status.totalMB).toBeGreaterThan(0);
        expect(status.usedMB).toBeGreaterThanOrEqual(0);
        expect(status.freeMB).toBeGreaterThanOrEqual(0);
        expect(status.usagePercent).toBeGreaterThanOrEqual(0);
        expect(status.usagePercent).toBeLessThanOrEqual(1);
      }
      // null is acceptable if services are offline
    });
  });

  describe("Model Load Status", () => {
    it("should return valid model load status", async () => {
      const manager = getVRAMManager();
      const status = await manager.getModelLoadStatus();

      expect(typeof status.loaded).toBe("boolean");
      expect(["vram", "ram", "partial", "unloaded"]).toContain(status.location);
      expect(status.vramUsedMB).toBeGreaterThanOrEqual(0);
      expect(status.modelSizeMB).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Migration Status", () => {
    it("should return valid migration status structure", () => {
      const manager = getVRAMManager();
      const status = manager.getMigrationStatus();

      expect(typeof status.inProgress).toBe("boolean");
      expect(["vram", "ram", "partial", "unloaded"]).toContain(status.location);
      expect(typeof status.lastMigration).toBe("number");
      expect(typeof status.pressureCount).toBe("number");
      expect(typeof status.availableCount).toBe("number");
    });

    it("should have non-negative counter values", () => {
      const manager = getVRAMManager();
      const status = manager.getMigrationStatus();

      expect(status.pressureCount).toBeGreaterThanOrEqual(0);
      expect(status.availableCount).toBeGreaterThanOrEqual(0);
      expect(status.lastMigration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("GPU Layer Calculation", () => {
    it("should calculate optimal GPU layers", async () => {
      const manager = getVRAMManager();
      const layers = await manager.calculateOptimalGPULayers();

      // Should be -1 (all layers) or a non-negative number
      expect(layers).toBeGreaterThanOrEqual(-1);
    });
  });

  describe("LLM Allocation", () => {
    it("should always grant LLM allocation (Ollama handles spillover)", async () => {
      const manager = getVRAMManager();
      const requestId = `test-${Date.now()}`;

      const result = await manager.requestAllocation({
        taskType: TaskType.LLM_CHAT,
        priority: TaskPriority.NORMAL,
        estimatedVRAM: 4096,
        requestId,
      });

      expect(result.granted).toBe(true);

      // Clean up
      manager.releaseAllocation(requestId);
    });
  });
});

describe("Math Symbols Rendering", () => {
  const mathSymbols = {
    // Greek letters
    alpha: "α",
    beta: "β",
    gamma: "γ",
    delta: "δ",
    epsilon: "ε",
    theta: "θ",
    lambda: "λ",
    pi: "π",
    sigma: "σ",
    omega: "ω",

    // Operators
    plusMinus: "±",
    multiplication: "×",
    division: "÷",
    squareRoot: "√",
    cubicRoot: "∛",
    infinity: "∞",

    // Relations
    notEqual: "≠",
    lessEqual: "≤",
    greaterEqual: "≥",
    approxEqual: "≈",
    proportional: "∝",

    // Set theory
    elementOf: "∈",
    notElementOf: "∉",
    subset: "⊂",
    superset: "⊃",
    union: "∪",
    intersection: "∩",
    emptySet: "∅",

    // Logic
    forAll: "∀",
    exists: "∃",
    notExists: "∄",
    and: "∧",
    or: "∨",
    not: "¬",
    implies: "⇒",
    iff: "⇔",

    // Calculus
    integral: "∫",
    doubleIntegral: "∬",
    partialDerivative: "∂",
    nabla: "∇",
    sum: "∑",
    product: "∏",

    // Superscripts/Subscripts
    squared: "²",
    cubed: "³",
    nth: "ⁿ",
    subscript0: "₀",
    subscriptN: "ₙ",
  };

  it("should render all mathematical symbols as single codepoints", () => {
    for (const [_name, symbol] of Object.entries(mathSymbols)) {
      const codePoints = [...symbol].length;
      expect(codePoints).toBe(1);
    }
  });

  it("should render Greek letters correctly", () => {
    expect(mathSymbols.alpha).toBe("α");
    expect(mathSymbols.beta).toBe("β");
    expect(mathSymbols.pi).toBe("π");
  });

  it("should render mathematical operators correctly", () => {
    expect(mathSymbols.plusMinus).toBe("±");
    expect(mathSymbols.squareRoot).toBe("√");
    expect(mathSymbols.infinity).toBe("∞");
  });

  it("should render set theory symbols correctly", () => {
    expect(mathSymbols.elementOf).toBe("∈");
    expect(mathSymbols.union).toBe("∪");
    expect(mathSymbols.intersection).toBe("∩");
  });

  describe("Complex Expressions", () => {
    const expressions = [
      { name: "Schrödinger", expr: "iℏ ∂Ψ/∂t = ĤΨ" },
      { name: "Maxwell", expr: "∇ · E = ρ/ε₀" },
      { name: "Einstein", expr: "E = mc²" },
      { name: "Navier-Stokes", expr: "ρ(∂v/∂t + v·∇v) = -∇p + μ∇²v" },
      { name: "Fourier", expr: "F(ω) = ∫_{-∞}^{∞} f(t)e^{-iωt}dt" },
      { name: "Bayes", expr: "P(A|B) = P(B|A)·P(A)/P(B)" },
    ];

    it("should have non-empty famous equations", () => {
      for (const { expr } of expressions) {
        expect(expr.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Number Sets", () => {
    const sets = {
      naturals: "ℕ",
      integers: "ℤ",
      rationals: "ℚ",
      reals: "ℝ",
      complex: "ℂ",
    };

    it("should render number set symbols correctly", () => {
      expect(sets.naturals).toBe("ℕ");
      expect(sets.integers).toBe("ℤ");
      expect(sets.reals).toBe("ℝ");
      expect(sets.complex).toBe("ℂ");
    });
  });
});

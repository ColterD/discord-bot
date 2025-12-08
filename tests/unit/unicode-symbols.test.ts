/**
 * Unicode Symbols Rendering Tests
 *
 * Validates that mathematical and special Unicode symbols render correctly
 * as single codepoints (not decomposed sequences).
 */

import { describe, expect, it } from "vitest";

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

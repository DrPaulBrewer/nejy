import { create, all } from 'mathjs';

const math = create(all);

export default function mathFunction(params, expr) {
  const compiled = math.compile(expr);
  return (...args) => {
    return compiled.evaluate(new Map(params.map((name, i) => [name, args[i]])));
  };
}

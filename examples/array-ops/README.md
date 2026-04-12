# Array Operations Examples

These scripts demonstrate how to perform high-iteration mathematical operations over arrays safely within the `nejy` interpreter using `mathFunction` callbacks, `Array.map()`, and `Array.reduce()`.

1. These scripts are based on the following one-liner JavaScript code for adding the series `1/1 + 1/2 + 1/3 + 1/4 + ... + 1/1000000`:
   ```javascript
   new Array(1000000).fill(0).map((v,i)=>(1.0/(1.0+i))).reduce((acc,i)=>(acc+i))
   ```

2. Expected Result: roughly `14.3927`

3. Performance Note: `test1.json` (which uses variable state explicitly between assignments) completes in a few seconds. `test2.yaml` uses the `PIPE` construct to pass array elements directly across commands and evaluates much faster (around 180ms), which is likely due to the `PIPE` implementation avoiding intermediate interpreter state resolutions, or due to JavaScript's internal array processing optimizations.

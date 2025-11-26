export default [
  {
    ignores: ["**/*.min.js", "**/node_modules/**"],
  },
  {
    files: ["**/*.js"],
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "off",
    },
  },
];

const path = require("path");
const webpack = require("webpack");
const CopyPlugin = require("copy-webpack-plugin");

/** @type {webpack.Configuration} */
const config = {
  mode: "production",
  entry: "./rule2rego.ts",
  target: "node",
  devtool: false,
  output: {
    path: path.resolve(__dirname, "dist"),
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, "node_modules/web-tree-sitter/tree-sitter.wasm"),
          to: path.resolve(__dirname, "dist/tree-sitter.wasm"),
        },
        {
          from: path.resolve(__dirname, "tree-sitter-eventrule.wasm"),
          to: path.resolve(__dirname, "dist/tree-sitter-eventrule.wasm"),
        },
      ],
    }),
  ],
  optimization: {
    minimize: true,
    nodeEnv: false,
  },
  node: {
    global: false,
    __dirname: false,
    __filename: false,
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/i,
        loader: "ts-loader",
        exclude: ["/node_modules/"],
      },
    ],
  },
  externalsPresets: { node: true },
  resolve: {
    extensions: [".tsx", ".ts", ".jsx", ".js", "..."],
  },
};

module.exports = config;

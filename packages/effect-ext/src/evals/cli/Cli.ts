/**
 * The `effect-evals` root command: `run` is its only subcommand for now
 * (no watch mode).
 *
 * @module cli/Cli
 *
 * @copyright Thomas Foster
 */

import { Command } from "effect/cli";
import packageJson from "../../../package.json" with { type: "json" };
import { runCommand } from "./RunCommand.ts";

export const version: string = packageJson.version;

export const cli = Command.make("effect-evals").pipe(
  Command.withDescription("Discover and run effect-evals suites — no test framework involved."),
  Command.withSubcommands([runCommand]),
);

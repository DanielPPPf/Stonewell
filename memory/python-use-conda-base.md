---
name: python-use-conda-base
description: For Python work in the stonewell project, use the user's conda envs, not a fresh venv
metadata:
  type: feedback
---

When running Python in the stonewell project, use one of the user's existing conda environments (activate via `source ~/miniconda3/etc/profile.d/conda.sh && conda activate base`) instead of creating a new venv. The `base` env already has PIL + numpy; vtracer and cairosvg were pip-installed into it for logo vectorization.

**Why:** The user explicitly asked to use their conda environments rather than a throwaway venv.
**How to apply:** Activate conda base (or another named env) before invoking `python`/`pip`; install missing packages there. Don't create `.venv` directories.

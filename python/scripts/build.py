"""Course builder."""

from argparse import ArgumentParser, Namespace, RawDescriptionHelpFormatter
import sys

from . import dependency, task
from .dependency import DependencyGraph
from .language import languages as supported_languages


class UnknownLanguage(Exception):
    """E.g. non ISO 639-3 language code or not supported."""


def parse_languages(languages: str) -> list[str]:
    """Parse languages str from command-line.

    Raises UnknownLanguage on error.
    """
    if languages == "_":
        return list(supported_languages)
    result = []
    for lang in languages.split(","):
        if lang in supported_languages:
            result.append(lang)
        else:
            raise UnknownLanguage(lang)
    return result


def parse_args() -> Namespace:
    description = "Build course files."
    epilog = """
examples:
  build.py eng
    Build all English -> * courses.

  build.py _ eng
    Build all * -> English courses.

  build.py eng fra,spa
    Build English -> French and English -> Spanish courses.
"""
    parser = ArgumentParser(
        description=description,
        epilog=epilog,
        formatter_class=RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "-l",
        dest="show_supported_languages",
        action="store_true",
        help="show list of supported languages",
    )
    parser.add_argument(
        "-B",
        dest="build_always",
        action="store_true",
        help="build all targets unconditionally",
    )
    parser.add_argument(
        "--verbose",
        dest="verbose",
        action="store_true",
        help="increase verbosity",
    )
    parser.add_argument(
        "l1",
        default="_",
        nargs="?",
        help="default: '_' (all languages)",
    )
    parser.add_argument(
        "l2",
        default="_",
        nargs="?",
        help="default: '_' (all languages)",
    )
    return parser.parse_args()


def show_supported_languages() -> None:
    for code, language in supported_languages.items():
        print(code, "-", language.name)
    sys.exit()


def build_dependency_graph(l1s: list[str], l2s: list[str]) -> DependencyGraph:
    # Build dependency graph
    deps = DependencyGraph()
    deps.add(task.decompress_links, task.download_latest)
    deps.add(task.decompress_sentences, task.download_latest)
    deps.add(task.prepare_sentences, task.decompress_sentences)
    deps.add(
        task.prepare_links,
        task.decompress_links,
        task.decompress_sentences,
    )

    for lang in sorted(set(l1s + l2s)):
        deps.add(task.language_tokenizer(lang), task.prepare_sentences)

    for lang1 in l1s:
        for lang2 in l2s:
            if lang1 != lang2:
                deps.add(
                    task.compute_difficulty(lang1, lang2),
                    task.language_tokenizer(lang2),
                    task.prepare_links,
                )
                deps.add(
                    task.course_builder(lang1, lang2),
                    task.create_empty_course,
                    task.prepare_links,
                    task.language_tokenizer(lang1),
                    task.language_tokenizer(lang2),
                    task.create_course_directory,
                    task.compute_difficulty(lang1, lang2),
                )
                deps.add(
                    task.create_word_list(lang1, lang2),
                    task.course_builder(lang1, lang2),
                )
    return deps


def main(args: Namespace) -> None:
    if args.show_supported_languages:
        show_supported_languages()

    try:
        l1s = parse_languages(args.l1)
        l2s = parse_languages(args.l2)
    except UnknownLanguage as exc:
        sys.exit(f"unknown language: {exc.args[0]}")

    if args.build_always:
        dependency.BUILD_ALWAYS = True

    deps = build_dependency_graph(l1s, l2s)
    summary = deps.execute()
    if args.verbose:
        print(str(summary))


if __name__ == "__main__":
    main(parse_args())

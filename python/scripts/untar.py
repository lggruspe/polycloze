"""Unarchive tatoeba data."""

from argparse import ArgumentParser, Namespace
from concurrent.futures import ProcessPoolExecutor
from os import utime
from pathlib import Path
from shutil import copytree
import sys
import tarfile
from tempfile import TemporaryDirectory

from .dependency import is_outdated
from .download import latest_data


def untar(destination: Path, infile: Path) -> None:
    """Unarchive single file into destination.

    The operation is first done in a temp directory to avoid half-finished
    outputs.
    Does not preserve modification time of files.
    """
    with (
        tarfile.open(infile, "r:bz2") as tar,
        TemporaryDirectory() as tmpname,
    ):
        tmp = Path(tmpname)
        
        import os
        
        def is_within_directory(directory, target):
            
            abs_directory = os.path.abspath(directory)
            abs_target = os.path.abspath(target)
        
            prefix = os.path.commonprefix([abs_directory, abs_target])
            
            return prefix == abs_directory
        
        def safe_extract(tar, path=".", members=None, *, numeric_owner=False):
        
            for member in tar.getmembers():
                member_path = os.path.join(path, member.name)
                if not is_within_directory(path, member_path):
                    raise Exception("Attempted Path Traversal in Tar File")
        
            tar.extractall(path, members, numeric_owner=numeric_owner) 
            
        
        safe_extract(tar, tmp)

        # Update mtime, because original mtime < mtime of tar archive.
        for path in tmp.iterdir():
            utime(path)

        copytree(tmp, destination, dirs_exist_ok=True)


def parse_args() -> Namespace:
    parser = ArgumentParser(
        description="Unarchive Tatoeba data.",
    )
    parser.add_argument(
        "-l",
        dest="links",
        type=Path,
        help="Tatoeba links.tar.bz2 file",
    )
    parser.add_argument(
        "-s",
        dest="sentences",
        type=Path,
        help="Tatoeba sentences.tar.bz2 file",
    )
    return parser.parse_args()


def main(args: Namespace) -> None:
    downloads = Path("build")/"tatoeba"
    if not args.links or not args.sentences:
        try:
            links, sentences = latest_data(downloads)
            args.links = links.destination(downloads)
            args.sentences = sentences.destination(downloads)

            assert args.links.is_file()
            assert args.sentences.is_file()
        except AssertionError:
            sys.exit("no data found")

    if not is_outdated(
        [downloads/"links.csv", downloads/"sentences.csv"],
        [args.links, args.sentences],
    ):
        return

    print("Extracting data...")
    with ProcessPoolExecutor() as executor:
        futures = [
            executor.submit(untar, downloads, args.links),
            executor.submit(untar, downloads, args.sentences),
        ]
        for future in futures:
            future.result()
    print("Done extracting data")


if __name__ == "__main__":
    main(parse_args())

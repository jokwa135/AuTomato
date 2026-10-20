from setuptools import setup, find_namespace_packages

setup(
    name='cli-anything-automato', version='0.3.2',
    description='Local CLI for the AuTomato desktop workspace',
    license='MIT',
    python_requires='>=3.10',
    packages=find_namespace_packages(include=['cli_anything.*']),
    package_data={'cli_anything.automato': ['skills/*.md', 'licenses/*.txt']},
    install_requires=['click>=8.1'],
    entry_points={'console_scripts': ['cli-anything-automato=cli_anything.automato.automato_cli:main']},
)

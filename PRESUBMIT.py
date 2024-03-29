# Copyright (c) 2011 The Native Client Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

# Documentation on PRESUBMIT.py can be found at:
# http://www.chromium.org/developers/how-tos/depottools/presubmit-scripts

import os
import subprocess


_EXCLUDED_PATHS = (
    # patch_configure.py contains long lines embedded in multi-line
    # strings.
    r"^build_tools[\\\/]patch_configure.py",
)

def CheckBuildbot(input_api, output_api):
  try:
    cmd = ['build_tools/partition.py', '--check']
    subprocess.check_call(cmd)
  except subprocess.CalledProcessError as e:
    return [output_api.PresubmitError('%s failed' % str(cmd))]
  return []


def CheckDeps(input_api, output_api):
  try:
    subprocess.check_call(['build_tools/check_deps.py'])
  except subprocess.CalledProcessError as e:
    message = 'update_mirror.py --check failed.'
    message += '\nRun build_tools/update_mirror.py to update.'
    return [output_api.PresubmitError(message)]
  return []


def CheckMirror(input_api, output_api):
  try:
    subprocess.check_call(['build_tools/update_mirror.py', '--check'])
  except subprocess.CalledProcessError as e:
    message = 'update_mirror.py --check failed.'
    message += '\nRun build_tools/update_mirror.py to update.'
    return [output_api.PresubmitError(message)]
  return []


def RunUnittests(input_api, output_api):
  try:
    subprocess.check_call(['lib/naclports_test.py'])
  except subprocess.CalledProcessError as e:
    return [output_api.PresubmitError(message)]
  return []


def CheckChangeOnUpload(input_api, output_api):
  report = []
  affected_files = input_api.AffectedFiles(include_deletes=False)
  report.extend(RunUnittests(input_api, output_api))
  report.extend(CheckDeps(input_api, output_api))
  report.extend(input_api.canned_checks.PanProjectChecks(
      input_api, output_api, project_name='Native Client',
      excluded_paths=_EXCLUDED_PATHS))
  return report


def CheckChangeOnCommit(input_api, output_api):
  report = []
  report.extend(CheckChangeOnUpload(input_api, output_api))
  report.extend(CheckMirror(input_api, output_api))
  report.extend(CheckBuildbot(input_api, output_api))
  report.extend(input_api.canned_checks.CheckTreeIsOpen(
      input_api, output_api,
      json_url='http://naclports-status.appspot.com/current?format=json'))
  return report


TRYBOTS = [
    'naclports-linux-glibc-0',
    'naclports-linux-glibc-1',
    'naclports-linux-glibc-2',
    'naclports-linux-glibc-3',
    'naclports-linux-glibc-4',
    'naclports-linux-newlib-0',
    'naclports-linux-newlib-1',
    'naclports-linux-newlib-2',
    'naclports-linux-newlib-3',
    'naclports-linux-newlib-4',
    'naclports-linux-pnacl_newlib-0',
    'naclports-linux-pnacl_newlib-1',
    'naclports-linux-pnacl_newlib-2',
    'naclports-linux-pnacl_newlib-3',
    'naclports-linux-pnacl_newlib-4',
    'naclports-linux-bionic-0',
    'naclports-linux-bionic-1',
    'naclports-linux-bionic-2',
    'naclports-linux-bionic-3',
    'naclports-linux-bionic-4',
]


def GetPreferredTryMasters(_, change):
  return {
    'tryserver.chromium': { t: set(['defaulttests']) for t in TRYBOTS },
  }

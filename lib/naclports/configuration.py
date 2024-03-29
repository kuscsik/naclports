# Copyright (c) 2014 The Native Client Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

import os
import platform

import naclports

class Configuration(object):
  """Class representing the build configuration for naclports packages.

  This consists of the following attributes:
    toolchain   - newlib, glibc, bionic, pnacl
    arch        - x86_64, x86_32, arm, pnacl
    debug       - True/False
    config_name - 'debug' or 'release'

  If not specified in the constructor these are read from the
  environment variables (TOOLCHAIN, NACL_ARCH, NACL_DEBUG).
  """
  default_toolchain = 'newlib'

  def __init__(self, arch=None, toolchain=None, debug=None):
    self.SetConfig(debug)

    if arch is None:
      arch = os.environ.get('NACL_ARCH')

    if toolchain is None:
      toolchain = os.environ.get('TOOLCHAIN')

    if not toolchain:
      if arch == 'pnacl':
        toolchain = 'pnacl'
      else:
        toolchain = self.default_toolchain
    self.toolchain = toolchain

    if not arch:
      if self.toolchain == 'pnacl':
        arch = 'pnacl'
      elif self.toolchain == 'bionic':
        arch = 'arm'
      elif platform.machine() == 'i686':
        arch = 'i686'
      else:
        arch = 'x86_64'

    self.arch = arch
    if self.arch not in naclports.arch_to_pkgarch:
      raise naclports.Error("Invalid arch: %s" % arch)

    self.SetLibc()

  def SetConfig(self, debug):
    if debug is None:
      if os.environ.get('NACL_DEBUG') == '1':
        debug = True
      else:
        debug = False
    self.debug = debug
    if self.debug:
      self.config_name = 'debug'
    else:
      self.config_name = 'release'

  def SetLibc(self):
    if self.toolchain == 'pnacl':
      self.libc = 'newlib'
    else:
      self.libc = self.toolchain

  def __hash__(self):
    return hash(str(self))

  def __cmp__(self, other):
    return cmp((self.libc, self.toolchain, self.debug),
               (other.libc, other.toolchain, other.debug))

  def __str__(self):
    return '%s/%s/%s' % (self.arch, self.libc, self.config_name)

  def __repr__(self):
    return '<Configuration %s>' % str(self)

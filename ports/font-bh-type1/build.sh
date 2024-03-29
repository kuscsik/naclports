# Copyright (c) 2014 The Native Client Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

PATH="${BUILD_DIR}/../../font-util/install-nacl-host/bin:${PATH}"

# Disable running on mkfontdir on install.
export ac_cv_path_MKFONTDIR=echo
export ac_cv_path_MKFONTSCALE=echo

# Setting this as the fonts don't seem to honor --prefix for everything.
EXTRA_CONFIGURE_ARGS="--with-fontrootdir=${PREFIX}/share/fonts/X11"

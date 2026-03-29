use std::path::Path;

#[derive(Debug, Clone, serde::Serialize)]
pub struct Symbol {
    pub name: String,
    pub kind: SymbolKind,
    pub signature: Option<String>,
    pub line: usize,
    pub end_line: Option<usize>,
    pub exported: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub enum SymbolKind {
    Function,
    Class,
    Interface,
    Type,
    Variable,
    Method,
}

impl SymbolKind {
    pub fn as_str(&self) -> &str {
        match self {
            SymbolKind::Function => "function",
            SymbolKind::Class => "class",
            SymbolKind::Interface => "interface",
            SymbolKind::Type => "type",
            SymbolKind::Variable => "variable",
            SymbolKind::Method => "method",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Import {
    pub source: String,
    pub symbols: Vec<String>,
    pub line: usize,
}

pub struct ParseResult {
    pub symbols: Vec<Symbol>,
    pub imports: Vec<Import>,
}

#[derive(Debug, Clone, Copy)]
pub enum Language {
    TypeScript,
    JavaScript,
    Python,
    Rust,
    Go,
}

/// Detect the programming language from a file extension.
pub fn detect_language(path: &Path) -> Option<Language> {
    match path.extension()?.to_str()? {
        "ts" | "tsx" => Some(Language::TypeScript),
        "js" | "jsx" | "mjs" | "cjs" => Some(Language::JavaScript),
        "py" => Some(Language::Python),
        "rs" => Some(Language::Rust),
        "go" => Some(Language::Go),
        _ => None,
    }
}

/// Parse a source file and extract symbols and imports.
pub fn parse_file(path: &Path) -> Result<ParseResult, String> {
    let lang = detect_language(path).ok_or_else(|| format!("Unsupported file: {:?}", path))?;
    let source = std::fs::read_to_string(path).map_err(|e| format!("Read error: {e}"))?;
    let source_bytes = source.as_bytes();

    let mut parser = tree_sitter::Parser::new();
    let ts_lang: tree_sitter::Language = match lang {
        Language::TypeScript => {
            if path.extension().and_then(|e| e.to_str()) == Some("tsx") {
                tree_sitter_typescript::LANGUAGE_TSX.into()
            } else {
                tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
            }
        }
        Language::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
        Language::Python => tree_sitter_python::LANGUAGE.into(),
        Language::Rust => tree_sitter_rust::LANGUAGE.into(),
        Language::Go => tree_sitter_go::LANGUAGE.into(),
    };
    parser
        .set_language(&ts_lang)
        .map_err(|e| format!("Language error: {e}"))?;

    let tree = parser
        .parse(&source, None)
        .ok_or_else(|| "Parse failed".to_string())?;

    let root = tree.root_node();
    let mut symbols = Vec::new();
    let mut imports = Vec::new();

    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        match lang {
            Language::TypeScript | Language::JavaScript => {
                extract_ts_node(child, source_bytes, &mut symbols, &mut imports);
            }
            Language::Python => {
                extract_python_node(child, source_bytes, &mut symbols, &mut imports);
            }
            Language::Rust => {
                extract_rust_node(child, source_bytes, &mut symbols, &mut imports);
            }
            Language::Go => {
                extract_go_node(child, source_bytes, &mut symbols, &mut imports);
            }
        }
    }

    Ok(ParseResult { symbols, imports })
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/// Extract the text content of a node from the source bytes.
fn node_text<'a>(node: tree_sitter::Node, source: &'a [u8]) -> &'a str {
    node.utf8_text(source).unwrap_or("")
}

/// Get the first line of a node (used as the signature).
fn extract_line_text(node: tree_sitter::Node, source: &[u8]) -> String {
    let text = node_text(node, source);
    text.lines().next().unwrap_or("").to_string()
}

/// Check if a TypeScript/JavaScript node is exported (parent is `export_statement`).
fn is_exported_ts(node: tree_sitter::Node) -> bool {
    node.parent()
        .map(|p| p.kind() == "export_statement")
        .unwrap_or(false)
}

/// Check if a Rust node has a `visibility_modifier` child containing "pub".
fn has_visibility(node: tree_sitter::Node, source: &[u8]) -> bool {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "visibility_modifier" {
            return node_text(child, source).contains("pub");
        }
    }
    false
}

// ---------------------------------------------------------------------------
// TypeScript / JavaScript extraction
// ---------------------------------------------------------------------------

fn extract_ts_node(
    node: tree_sitter::Node,
    source: &[u8],
    symbols: &mut Vec<Symbol>,
    imports: &mut Vec<Import>,
) {
    let kind = node.kind();

    match kind {
        "export_statement" => {
            // Walk into the export to find the actual declaration
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                let child_kind = child.kind();
                match child_kind {
                    "function_declaration" => {
                        if let Some(sym) = make_symbol(child, source, SymbolKind::Function, true) {
                            symbols.push(sym);
                        }
                    }
                    "class_declaration" => {
                        if let Some(sym) = make_symbol(child, source, SymbolKind::Class, true) {
                            symbols.push(sym);
                        }
                        // Also extract methods from the class body
                        extract_ts_class_methods(child, source, symbols);
                    }
                    "interface_declaration" => {
                        if let Some(sym) =
                            make_symbol(child, source, SymbolKind::Interface, true)
                        {
                            symbols.push(sym);
                        }
                    }
                    "type_alias_declaration" => {
                        if let Some(sym) = make_symbol(child, source, SymbolKind::Type, true) {
                            symbols.push(sym);
                        }
                    }
                    "lexical_declaration" | "variable_declaration" => {
                        extract_ts_variable_declaration(child, source, symbols, true);
                    }
                    _ => {}
                }
            }
        }
        "function_declaration" => {
            if let Some(sym) = make_symbol(node, source, SymbolKind::Function, false) {
                symbols.push(sym);
            }
        }
        "class_declaration" => {
            let exported = is_exported_ts(node);
            if let Some(sym) = make_symbol(node, source, SymbolKind::Class, exported) {
                symbols.push(sym);
            }
            extract_ts_class_methods(node, source, symbols);
        }
        "interface_declaration" => {
            if let Some(sym) = make_symbol(node, source, SymbolKind::Interface, false) {
                symbols.push(sym);
            }
        }
        "type_alias_declaration" => {
            if let Some(sym) = make_symbol(node, source, SymbolKind::Type, false) {
                symbols.push(sym);
            }
        }
        "lexical_declaration" | "variable_declaration" => {
            extract_ts_variable_declaration(node, source, symbols, false);
        }
        "import_statement" => {
            if let Some(imp) = extract_ts_import(node, source) {
                imports.push(imp);
            }
        }
        _ => {}
    }
}

fn extract_ts_class_methods(
    class_node: tree_sitter::Node,
    source: &[u8],
    symbols: &mut Vec<Symbol>,
) {
    if let Some(body) = class_node.child_by_field_name("body") {
        let mut cursor = body.walk();
        for child in body.children(&mut cursor) {
            if child.kind() == "method_definition" {
                if let Some(sym) = make_symbol(child, source, SymbolKind::Method, false) {
                    symbols.push(sym);
                }
            }
        }
    }
}

fn extract_ts_variable_declaration(
    node: tree_sitter::Node,
    source: &[u8],
    symbols: &mut Vec<Symbol>,
    exported: bool,
) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "variable_declarator" {
            if let Some(name_node) = child.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                symbols.push(Symbol {
                    name,
                    kind: SymbolKind::Variable,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported,
                });
            }
        }
    }
}

fn extract_ts_import(node: tree_sitter::Node, source: &[u8]) -> Option<Import> {
    let mut src = String::new();
    let mut syms = Vec::new();

    if let Some(source_node) = node.child_by_field_name("source") {
        // The source node is a string literal — strip quotes
        let raw = node_text(source_node, source);
        src = raw.trim_matches(|c| c == '\'' || c == '"').to_string();
    }

    // Look for import_clause > named_imports > import_specifier
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_import_specifiers(child, source, &mut syms);
    }

    if src.is_empty() {
        return None;
    }

    Some(Import {
        source: src,
        symbols: syms,
        line: node.start_position().row + 1,
    })
}

fn collect_import_specifiers(
    node: tree_sitter::Node,
    source: &[u8],
    syms: &mut Vec<String>,
) {
    match node.kind() {
        "import_specifier" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                syms.push(node_text(name_node, source).to_string());
            }
        }
        "import_clause" | "named_imports" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                collect_import_specifiers(child, source, syms);
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Python extraction
// ---------------------------------------------------------------------------

fn extract_python_node(
    node: tree_sitter::Node,
    source: &[u8],
    symbols: &mut Vec<Symbol>,
    imports: &mut Vec<Import>,
) {
    match node.kind() {
        "function_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                let exported = !name.starts_with('_');
                symbols.push(Symbol {
                    name,
                    kind: SymbolKind::Function,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported,
                });
            }
        }
        "class_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                let exported = !name.starts_with('_');
                symbols.push(Symbol {
                    name,
                    kind: SymbolKind::Class,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported,
                });
            }
            // Also extract methods from the class body
            if let Some(body) = node.child_by_field_name("body") {
                let mut body_cursor = body.walk();
                for body_child in body.children(&mut body_cursor) {
                    if body_child.kind() == "function_definition" {
                        if let Some(name_node) = body_child.child_by_field_name("name") {
                            let name = node_text(name_node, source).to_string();
                            symbols.push(Symbol {
                                name,
                                kind: SymbolKind::Method,
                                signature: Some(extract_line_text(body_child, source)),
                                line: body_child.start_position().row + 1,
                                end_line: Some(body_child.end_position().row + 1),
                                exported: true,
                            });
                        }
                    }
                }
            }
        }
        "import_from_statement" => {
            if let Some(imp) = extract_python_import(node, source) {
                imports.push(imp);
            }
        }
        _ => {}
    }
}

fn extract_python_import(node: tree_sitter::Node, source: &[u8]) -> Option<Import> {
    let mut src = String::new();
    let mut syms = Vec::new();

    if let Some(module_node) = node.child_by_field_name("module_name") {
        src = node_text(module_node, source).to_string();
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "dotted_name" && src.is_empty() {
            // Fallback: first dotted_name is the module
            src = node_text(child, source).to_string();
        }
        if child.kind() == "import_from_statement" || child.kind() == "aliased_import" {
            if let Some(name_node) = child.child_by_field_name("name") {
                syms.push(node_text(name_node, source).to_string());
            }
        }
        // Named imports appear as direct identifier children after "import" keyword
        if child.kind() == "dotted_name" && !src.is_empty() && node_text(child, source) != src {
            syms.push(node_text(child, source).to_string());
        }
    }

    // If we still don't have source, try extracting from the full text
    if src.is_empty() {
        return None;
    }

    Some(Import {
        source: src,
        symbols: syms,
        line: node.start_position().row + 1,
    })
}

// ---------------------------------------------------------------------------
// Rust extraction
// ---------------------------------------------------------------------------

fn extract_rust_node(
    node: tree_sitter::Node,
    source: &[u8],
    symbols: &mut Vec<Symbol>,
    imports: &mut Vec<Import>,
) {
    match node.kind() {
        "function_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                let exported = has_visibility(node, source);
                symbols.push(Symbol {
                    name,
                    kind: SymbolKind::Function,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported,
                });
            }
        }
        "struct_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                let exported = has_visibility(node, source);
                symbols.push(Symbol {
                    name,
                    kind: SymbolKind::Class,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported,
                });
            }
        }
        "enum_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                let exported = has_visibility(node, source);
                symbols.push(Symbol {
                    name,
                    kind: SymbolKind::Class,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported,
                });
            }
        }
        "type_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                let exported = has_visibility(node, source);
                symbols.push(Symbol {
                    name,
                    kind: SymbolKind::Type,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported,
                });
            }
        }
        "use_declaration" => {
            if let Some(imp) = extract_rust_import(node, source) {
                imports.push(imp);
            }
        }
        "impl_item" => {
            // Extract methods from impl blocks
            extract_rust_impl_methods(node, source, symbols);
        }
        _ => {}
    }
}

fn extract_rust_impl_methods(
    node: tree_sitter::Node,
    source: &[u8],
    symbols: &mut Vec<Symbol>,
) {
    if let Some(body) = node.child_by_field_name("body") {
        let mut cursor = body.walk();
        for child in body.children(&mut cursor) {
            if child.kind() == "function_item" {
                if let Some(name_node) = child.child_by_field_name("name") {
                    let name = node_text(name_node, source).to_string();
                    let exported = has_visibility(child, source);
                    symbols.push(Symbol {
                        name,
                        kind: SymbolKind::Method,
                        signature: Some(extract_line_text(child, source)),
                        line: child.start_position().row + 1,
                        end_line: Some(child.end_position().row + 1),
                        exported,
                    });
                }
            }
        }
    }
}

fn extract_rust_import(node: tree_sitter::Node, source: &[u8]) -> Option<Import> {
    // `use std::path::Path;` → source = "std::path::Path", symbols = ["Path"]
    let text = node_text(node, source).to_string();
    // Strip `use ` prefix and trailing `;`
    let trimmed = text
        .strip_prefix("pub use ")
        .or_else(|| text.strip_prefix("use "))
        .unwrap_or(&text)
        .trim_end_matches(';')
        .trim();

    let source_str = trimmed.to_string();
    let mut syms = Vec::new();

    // Extract the last segment as the symbol name
    if let Some(last) = source_str.rsplit("::").next() {
        // Handle `{A, B}` groups
        let inner = last.trim_matches(|c| c == '{' || c == '}').trim();
        for part in inner.split(',') {
            let s = part.trim();
            if !s.is_empty() {
                syms.push(s.to_string());
            }
        }
    }

    Some(Import {
        source: source_str,
        symbols: syms,
        line: node.start_position().row + 1,
    })
}

// ---------------------------------------------------------------------------
// Go extraction
// ---------------------------------------------------------------------------

fn extract_go_node(
    node: tree_sitter::Node,
    source: &[u8],
    symbols: &mut Vec<Symbol>,
    imports: &mut Vec<Import>,
) {
    match node.kind() {
        "function_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                let exported = name.starts_with(|c: char| c.is_uppercase());
                symbols.push(Symbol {
                    name,
                    kind: SymbolKind::Function,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported,
                });
            }
        }
        "method_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, source).to_string();
                let exported = name.starts_with(|c: char| c.is_uppercase());
                symbols.push(Symbol {
                    name,
                    kind: SymbolKind::Method,
                    signature: Some(extract_line_text(node, source)),
                    line: node.start_position().row + 1,
                    end_line: Some(node.end_position().row + 1),
                    exported,
                });
            }
        }
        "type_declaration" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() == "type_spec" {
                    if let Some(name_node) = child.child_by_field_name("name") {
                        let name = node_text(name_node, source).to_string();
                        let exported = name.starts_with(|c: char| c.is_uppercase());
                        symbols.push(Symbol {
                            name,
                            kind: SymbolKind::Type,
                            signature: Some(extract_line_text(child, source)),
                            line: child.start_position().row + 1,
                            end_line: Some(child.end_position().row + 1),
                            exported,
                        });
                    }
                }
            }
        }
        "import_declaration" => {
            extract_go_imports(node, source, imports);
        }
        _ => {}
    }
}

fn extract_go_imports(
    node: tree_sitter::Node,
    source: &[u8],
    imports: &mut Vec<Import>,
) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "import_spec_list" {
            let mut inner_cursor = child.walk();
            for spec in child.children(&mut inner_cursor) {
                if spec.kind() == "import_spec" {
                    if let Some(path_node) = spec.child_by_field_name("path") {
                        let raw = node_text(path_node, source);
                        let src = raw.trim_matches('"').to_string();
                        imports.push(Import {
                            source: src,
                            symbols: vec![],
                            line: spec.start_position().row + 1,
                        });
                    }
                }
            }
        }
        if child.kind() == "import_spec" {
            if let Some(path_node) = child.child_by_field_name("path") {
                let raw = node_text(path_node, source);
                let src = raw.trim_matches('"').to_string();
                imports.push(Import {
                    source: src,
                    symbols: vec![],
                    line: child.start_position().row + 1,
                });
            }
        }
        // Single import: `import "fmt"`
        if child.kind() == "interpreted_string_literal" {
            let raw = node_text(child, source);
            let src = raw.trim_matches('"').to_string();
            imports.push(Import {
                source: src,
                symbols: vec![],
                line: child.start_position().row + 1,
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

fn make_symbol(
    node: tree_sitter::Node,
    source: &[u8],
    kind: SymbolKind,
    exported: bool,
) -> Option<Symbol> {
    let name_node = node.child_by_field_name("name")?;
    let name = node_text(name_node, source).to_string();
    Some(Symbol {
        name,
        kind,
        signature: Some(extract_line_text(node, source)),
        line: node.start_position().row + 1,
        end_line: Some(node.end_position().row + 1),
        exported,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_typescript_function() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.ts");
        std::fs::write(
            &file,
            "export function hello(name: string): string {\n  return name;\n}\n",
        )
        .unwrap();
        let result = parse_file(&file).unwrap();
        assert_eq!(result.symbols.len(), 1);
        assert_eq!(result.symbols[0].name, "hello");
        assert!(result.symbols[0].exported);
        assert_eq!(result.symbols[0].line, 1);
    }

    #[test]
    fn test_parse_typescript_class_and_import() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.ts");
        std::fs::write(
            &file,
            "import { Router } from 'express';\nexport class UserService {\n  findById(id: string): void {}\n}\n",
        )
        .unwrap();
        let result = parse_file(&file).unwrap();
        assert!(result.symbols.iter().any(|s| s.name == "UserService"));
        assert_eq!(result.imports.len(), 1);
        assert_eq!(result.imports[0].source, "express");
    }

    #[test]
    fn test_detect_language() {
        assert!(matches!(
            detect_language(Path::new("foo.ts")),
            Some(Language::TypeScript)
        ));
        assert!(matches!(
            detect_language(Path::new("foo.py")),
            Some(Language::Python)
        ));
        assert!(matches!(
            detect_language(Path::new("foo.rs")),
            Some(Language::Rust)
        ));
        assert!(matches!(
            detect_language(Path::new("foo.go")),
            Some(Language::Go)
        ));
        assert!(detect_language(Path::new("foo.txt")).is_none());
    }

    #[test]
    fn test_parse_python() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.py");
        std::fs::write(
            &file,
            "from os.path import join\n\ndef hello(name):\n    return name\n\nclass MyClass:\n    pass\n",
        )
        .unwrap();
        let result = parse_file(&file).unwrap();
        assert!(result.symbols.iter().any(|s| s.name == "hello"));
        assert!(result.symbols.iter().any(|s| s.name == "MyClass"));
        assert_eq!(result.imports.len(), 1);
    }

    #[test]
    fn test_parse_python_class_methods() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.py");
        std::fs::write(
            &file,
            "class MyClass:\n    def method_one(self):\n        pass\n    def method_two(self, arg):\n        pass\n",
        )
        .unwrap();
        let result = parse_file(&file).unwrap();
        assert!(result.symbols.iter().any(|s| s.name == "MyClass"));
        assert!(result.symbols.iter().any(|s| s.name == "method_one"));
        assert!(result.symbols.iter().any(|s| s.name == "method_two"));
    }

    #[test]
    fn test_parse_rust() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.rs");
        std::fs::write(
            &file,
            "use std::path::Path;\n\npub fn hello(name: &str) -> String {\n    name.to_string()\n}\n\nstruct Inner;\n",
        )
        .unwrap();
        let result = parse_file(&file).unwrap();
        let hello = result.symbols.iter().find(|s| s.name == "hello").unwrap();
        assert!(hello.exported);
        let inner = result.symbols.iter().find(|s| s.name == "Inner").unwrap();
        assert!(!inner.exported);
        assert_eq!(result.imports.len(), 1);
    }

    #[test]
    fn test_parse_go() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.go");
        std::fs::write(
            &file,
            "package main\n\nimport \"fmt\"\n\nfunc Hello() {\n\tfmt.Println(\"hello\")\n}\n\nfunc private() {}\n",
        )
        .unwrap();
        let result = parse_file(&file).unwrap();
        let hello = result.symbols.iter().find(|s| s.name == "Hello").unwrap();
        assert!(hello.exported);
        let priv_fn = result.symbols.iter().find(|s| s.name == "private").unwrap();
        assert!(!priv_fn.exported);
    }
}

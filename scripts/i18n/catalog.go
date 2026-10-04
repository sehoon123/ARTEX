// Static display-metadata inventory. Does not import or execute ARTEX packages.
// Run from the repository root: go run scripts/i18n/catalog.go .
// ponytail: known constructor styles only; extend the allowlist when upstream adds a new factory.
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type entry struct {
	Key  string `json:"key"`
	Text string `json:"text"`
}

func literal(expr ast.Expr) (string, bool) {
	switch n := expr.(type) {
	case *ast.BasicLit:
		if n.Kind == token.STRING {
			value, err := strconv.Unquote(n.Value)
			return value, err == nil
		}
	case *ast.BinaryExpr:
		if n.Op == token.ADD {
			a, ok := literal(n.X)
			b, ok2 := literal(n.Y)
			return a + b, ok && ok2
		}
	case *ast.ParenExpr:
		return literal(n.X)
	}
	return "", false
}

type agentLabel struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Variables   map[string]string `json:"variables"`
}

type assetLabel struct {
	Kind    string `json:"kind"`
	Pattern string `json:"pattern"`
	Note    string `json:"note"`
}

type metadata struct {
	Agents          map[string]agentLabel `json:"agents"`
	VariableHelp    []string              `json:"variableHelp"`
	GlobalVariables map[string]string     `json:"globalVariables"`
	InterceptNames  []string              `json:"interceptNames"`
	AssetNotes      []string              `json:"assetNotes"`
	AssetRules      []assetLabel          `json:"assetRules"`
}

// Known positional Agent/variable declarations and reserved-name literals only.
// Unsupported changed declaration forms fail for manual inventory review.
func builtinMetadata(root string) metadata {
	out := metadata{Agents: map[string]agentLabel{}, VariableHelp: []string{}, GlobalVariables: map[string]string{}, InterceptNames: []string{}, AssetNotes: []string{}}
	fs := token.NewFileSet()
	mustLiteral := func(expr ast.Expr) string {
		value, ok := literal(expr)
		if !ok {
			panic(fmt.Sprintf("Unsupported builtin display label at %s", fs.Position(expr.Pos())))
		}
		return value
	}
	for _, path := range []string{"db/db.go", "server/server_mgmt.go"} {
		file, err := parser.ParseFile(fs, filepath.Join(root, path), nil, 0)
		if err != nil {
			panic(err)
		}
		ast.Inspect(file, func(node ast.Node) bool {
			if fn, ok := node.(*ast.FuncDecl); ok && path == "db/db.go" && fn.Name.Name == "seedDefaultAssetInterceptRules" {
				ast.Inspect(fn, func(node ast.Node) bool {
					if assignment, ok := node.(*ast.AssignStmt); ok && len(assignment.Lhs) == 1 && len(assignment.Rhs) == 1 {
						if name, ok := assignment.Lhs[0].(*ast.Ident); ok && name.Name == "rules" {
							list, ok := assignment.Rhs[0].(*ast.CompositeLit)
							if !ok {
								panic("Unsupported builtin asset rule catalog")
							}
							for _, item := range list.Elts {
								rule, ok := item.(*ast.CompositeLit)
								if !ok || len(rule.Elts) != 3 {
									panic("Unsupported builtin asset rule fields")
								}
								label := assetLabel{mustLiteral(rule.Elts[0]), mustLiteral(rule.Elts[1]), mustLiteral(rule.Elts[2])}
								out.AssetRules = append(out.AssetRules, label)
								out.AssetNotes = append(out.AssetNotes, label.Note)
							}
						}
					}
					return true
				})
				return false
			}
			if v, ok := node.(*ast.ValueSpec); ok && len(v.Names) == 1 {
				switch v.Names[0].Name {
				case "builtinAgents":
					if len(v.Values) != 1 {
						panic("Unsupported builtinAgents declaration")
					}
					list, ok := v.Values[0].(*ast.CompositeLit)
					if !ok {
						panic("Unsupported builtinAgents declaration")
					}
					for _, item := range list.Elts {
						a, ok := item.(*ast.CompositeLit)
						if !ok || len(a.Elts) < 5 {
							panic("Unsupported builtin Agent fields")
						}
						key := mustLiteral(a.Elts[0])
						if _, duplicate := out.Agents[key]; duplicate {
							panic("Duplicate builtin Agent key: " + key)
						}
						label := agentLabel{mustLiteral(a.Elts[1]), mustLiteral(a.Elts[3]), map[string]string{}}
						if vars, ok := a.Elts[4].(*ast.CompositeLit); ok {
							for _, item := range vars.Elts {
								v, ok := item.(*ast.CompositeLit)
								if !ok || len(v.Elts) < 2 {
									panic("Unsupported Agent variable fields")
								}
								name, description := mustLiteral(v.Elts[0]), mustLiteral(v.Elts[1])
								if _, duplicate := label.Variables[name]; duplicate {
									panic("Duplicate Agent variable: " + name)
								}
								label.Variables[name] = description
								out.VariableHelp = append(out.VariableHelp, description)
							}
						} else if id, ok := a.Elts[4].(*ast.Ident); !ok || id.Name != "nil" {
							panic("Unsupported Agent variable catalog")
						}
						out.Agents[key] = label
					}
				case "globalPromptVars":
					if len(v.Values) != 1 {
						panic("Unsupported globalPromptVars declaration")
					}
					list, ok := v.Values[0].(*ast.CompositeLit)
					if !ok {
						panic("Unsupported globalPromptVars declaration")
					}
					for _, item := range list.Elts {
						v, ok := item.(*ast.CompositeLit)
						if !ok {
							panic("Unsupported global variable fields")
						}
						var name, description string
						found := false
						for _, item := range v.Elts {
							kv, ok := item.(*ast.KeyValueExpr)
							if !ok {
								panic("Unsupported global variable fields")
							}
							if key, ok := kv.Key.(*ast.Ident); ok {
								if key.Name == "Description" {
									description = mustLiteral(kv.Value)
									out.VariableHelp = append(out.VariableHelp, description)
									found = true
								}
								if key.Name == "Name" {
									name = mustLiteral(kv.Value)
								}
							}
						}
						if !found || name == "" {
							panic("Missing global variable name/description")
						}
						if _, duplicate := out.GlobalVariables[name]; duplicate {
							panic("Duplicate global variable: " + name)
						}
						out.GlobalVariables[name] = description
					}
				}
			}
			if path == "db/db.go" {
				if value, ok := node.(*ast.BasicLit); ok && value.Kind == token.STRING {
					text := mustLiteral(value)
					if strings.HasPrefix(text, "[内置] ") {
						out.InterceptNames = append(out.InterceptNames, text)
					}
				}
			}
			return true
		})
	}
	if len(out.Agents) == 0 || len(out.VariableHelp) == 0 || len(out.InterceptNames) == 0 || len(out.AssetRules) == 0 {
		panic("Missing known builtin display metadata; review changed declarations")
	}
	return out
}

func main() {
	if len(os.Args) < 2 || len(os.Args) > 3 || (len(os.Args) == 3 && os.Args[2] != "--metadata") {
		panic("usage: catalog.go REPO_ROOT [--metadata]")
	}
	root := os.Args[1]
	if len(os.Args) == 3 {
		if err := json.NewEncoder(os.Stdout).Encode(builtinMetadata(root)); err != nil {
			panic(err)
		}
		return
	}
	fs := token.NewFileSet()
	entries := []entry{}
	for _, dir := range []string{"agent", "server", "traffic"} {
		files, err := filepath.Glob(filepath.Join(root, dir, "*.go"))
		if err != nil {
			panic(err)
		}
		for _, path := range files {
			if strings.HasSuffix(path, "_test.go") {
				continue
			}
			file, err := parser.ParseFile(fs, path, nil, 0)
			if err != nil {
				panic(err)
			}
			constants := map[string]string{}
			for _, decl := range file.Decls {
				if g, ok := decl.(*ast.GenDecl); ok && g.Tok == token.CONST {
					for _, spec := range g.Specs {
						if v, ok := spec.(*ast.ValueSpec); ok {
							for i, name := range v.Names {
								if i < len(v.Values) {
									if value, ok := literal(v.Values[i]); ok {
										constants[name.Name] = value
									}
								}
							}
						}
					}
				}
			}
			ast.Inspect(file, func(node ast.Node) bool {
				if composite, ok := node.(*ast.CompositeLit); ok {
					if kind, ok := composite.Type.(*ast.SelectorExpr); ok && kind.Sel.Name == "Spec" {
						var key, text string
						descriptionSupported := false
						for _, item := range composite.Elts {
							if kv, ok := item.(*ast.KeyValueExpr); ok {
								field, _ := kv.Key.(*ast.Ident)
								if field == nil {
									continue
								}
								value, supported := literal(kv.Value)
								if id, ok := kv.Value.(*ast.Ident); ok {
									value, supported = constants[id.Name]
								}
								if field.Name == "Name" {
									key = value
								}
								if field.Name == "Description" {
									text, descriptionSupported = value, supported
								}
							}
						}
						if key != "" {
							if !descriptionSupported {
								panic(fmt.Sprintf("Unsupported description for %s at %s", key, fs.Position(composite.Pos())))
							}
							entries = append(entries, entry{key, text})
						}
					}
				}
				call, ok := node.(*ast.CallExpr)
				if !ok || len(call.Args) < 2 {
					return true
				}
				var name string
				switch n := call.Fun.(type) {
				case *ast.Ident:
					name = n.Name
				case *ast.SelectorExpr:
					name = n.Sel.Name
				}
				switch name {
				case "readTool", "writeTool", "roTool", "wrTool", "readExpTool", "writeExpTool":
				default:
					return true
				}
				key, ok := literal(call.Args[0])
				if !ok {
					return true // Forwarding helpers do not declare a new tool.
				}
				text, ok := literal(call.Args[1])
				if !ok {
					panic(fmt.Sprintf("Nonliteral description for %s at %s", key, fs.Position(call.Pos())))
				}
				entries = append(entries, entry{key, text})
				return true
			})
		}
	}
	if len(entries) == 0 {
		panic("No tool metadata found")
	}
	if err := json.NewEncoder(os.Stdout).Encode(entries); err != nil {
		panic(err)
	}
}
